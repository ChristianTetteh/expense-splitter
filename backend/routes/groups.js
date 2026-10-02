const crypto = require("crypto");
const express = require("express");
const pool = require("../db");
const { splitEvenly } = require("../lib/money");
const {
  MAX_GROUP_MEMBERS,
  MAX_GROUPS_PER_USER,
  MAX_PENDING_PAYMENTS_PER_MEMBER,
  MAX_EXPENSES_PER_GROUP,
  MAX_PAYMENTS_PER_GROUP,
  parsePositiveInt,
  validateGroupName,
  validateExpenseInput,
  validatePaymentInput,
} = require("../lib/validation");
const { getMembership, loadMembers, memberNet, hasPendingItems, loadGroupState } = require("../lib/groupState");
const { asyncHandler, HttpError, NOT_FOUND } = require("../lib/http");

const router = express.Router();

const newInviteToken = () => crypto.randomBytes(24).toString("base64url");

async function activeMembershipCount(db, userId) {
  const r = await db.query("SELECT count(*)::int AS n FROM members WHERE user_id = $1 AND left_at IS NULL", [userId]);
  return r.rows[0].n;
}

// Runs `fn` in a transaction with the tab locked and the caller's active
// membership verified. Anything `fn` throws rolls the whole change back.
function inLockedGroup(req, fn) {
  return pool.withTransaction(async (client) => {
    const membership = await getMembership(client, req.params.groupId, req.user.id, { lock: true });
    if (!membership) throw NOT_FOUND();
    return fn(client, membership);
  });
}

async function sendState(res, membership, userId, status = 200) {
  const state = await loadGroupState(pool, membership, userId);
  res.status(status).json(state);
}

// ── Your tabs ────────────────────────────────────────────────────────────

// Only tabs you're currently a member of. There is no endpoint that lists
// anyone else's.
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      `SELECT g.id, g.name, g.created_at, (g.owner_id = $1) AS is_owner, m.id AS member_id,
         (SELECT count(*)::int FROM members x WHERE x.group_id = g.id AND x.left_at IS NULL) AS member_count,
         (SELECT count(*)::int FROM expense_shares s JOIN expenses e ON e.id = s.expense_id
            WHERE s.group_id = g.id AND s.member_id = m.id AND s.status = 'pending' AND e.voided_at IS NULL)
         + (SELECT count(*)::int FROM expense_shares s JOIN expenses e ON e.id = s.expense_id
            WHERE s.group_id = g.id AND e.payer_member_id = m.id AND s.status = 'declined' AND e.voided_at IS NULL)
         + (SELECT count(*)::int FROM payments p
            WHERE p.group_id = g.id AND p.to_member_id = m.id AND p.status = 'pending') AS needs_you,
         (
           COALESCE((SELECT sum(s.share_cents) FROM expense_shares s JOIN expenses e ON e.id = s.expense_id
                     WHERE e.group_id = g.id AND e.payer_member_id = m.id AND e.voided_at IS NULL
                       AND s.status = 'accepted'), 0)
         - COALESCE((SELECT sum(s.share_cents) FROM expense_shares s JOIN expenses e ON e.id = s.expense_id
                     WHERE s.group_id = g.id AND s.member_id = m.id AND e.voided_at IS NULL
                       AND s.status = 'accepted'), 0)
         + COALESCE((SELECT sum(p.amount_cents) FROM payments p
                     WHERE p.group_id = g.id AND p.from_member_id = m.id AND p.status = 'confirmed'), 0)
         - COALESCE((SELECT sum(p.amount_cents) FROM payments p
                     WHERE p.group_id = g.id AND p.to_member_id = m.id AND p.status = 'confirmed'), 0)
         )::bigint AS net_cents
       FROM members m JOIN groups g ON g.id = m.group_id
       WHERE m.user_id = $1 AND m.left_at IS NULL
       ORDER BY g.created_at DESC`,
      [req.user.id]
    );
    res.json({
      groups: result.rows.map((r) => ({
        id: r.id,
        name: r.name,
        created_at: r.created_at,
        is_owner: r.is_owner,
        member_count: r.member_count,
        needs_you: r.needs_you,
        net_cents: Number(r.net_cents),
      })),
    });
  })
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const { name, error } = validateGroupName(req.body);
    if (error) throw new HttpError(400, error);

    const groupId = await pool.withTransaction(async (client) => {
      // Serialise this user's tab creation so the cap can't be raced.
      await client.query("SELECT 1 FROM users WHERE id = $1 FOR UPDATE", [req.user.id]);
      if ((await activeMembershipCount(client, req.user.id)) >= MAX_GROUPS_PER_USER) {
        throw new HttpError(400, `You can be in at most ${MAX_GROUPS_PER_USER} tabs at once.`);
      }
      const g = await client.query(
        "INSERT INTO groups (name, owner_id, invite_token) VALUES ($1, $2, $3) RETURNING id",
        [name, req.user.id, newInviteToken()]
      );
      await client.query("INSERT INTO members (group_id, user_id) VALUES ($1, $2)", [g.rows[0].id, req.user.id]);
      return g.rows[0].id;
    });

    const membership = await getMembership(pool, groupId, req.user.id);
    await sendState(res, membership, req.user.id, 201);
  })
);

router.get(
  "/:groupId",
  asyncHandler(async (req, res) => {
    const membership = await getMembership(pool, req.params.groupId, req.user.id);
    if (!membership) throw NOT_FOUND();
    await sendState(res, membership, req.user.id);
  })
);

// ── Expenses ─────────────────────────────────────────────────────────────

// The payer is always YOU. You can split with anyone currently in the tab,
// but you can't record that somebody else paid — and each person you charge
// has to accept their share before it counts against them.
router.post(
  "/:groupId/expenses",
  asyncHandler(async (req, res) => {
    const membership = await inLockedGroup(req, async (client, m) => {
      const members = await loadMembers(client, m.group_id);
      const activeIds = new Set(members.filter((x) => !x.left_at).map((x) => x.id));
      const input = validateExpenseInput(req.body, activeIds);
      if (input.error) throw new HttpError(400, input.error);

      const count = await client.query("SELECT count(*)::int AS n FROM expenses WHERE group_id = $1", [m.group_id]);
      if (count.rows[0].n >= MAX_EXPENSES_PER_GROUP) {
        throw new HttpError(400, "This tab has reached its limit of expenses. Start a new tab.");
      }

      const shares = splitEvenly(input.amountCents, input.participantIds);
      const e = await client.query(
        `INSERT INTO expenses (group_id, payer_member_id, description, amount_cents)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [m.group_id, m.member_id, input.description, input.amountCents]
      );
      for (const [memberId, shareCents] of shares) {
        const own = memberId === m.member_id;
        await client.query(
          `INSERT INTO expense_shares (expense_id, group_id, member_id, share_cents, status, responded_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [e.rows[0].id, m.group_id, memberId, shareCents, own ? "accepted" : "pending", own ? new Date() : null]
        );
      }
      return m;
    });
    await sendState(res, membership, req.user.id, 201);
  })
);

// Voiding never deletes anything: the expense stays in the history, marked
// with who voided it and when. Only the person who paid can void it — the
// people who owe on it can't make their share disappear.
router.post(
  "/:groupId/expenses/:expenseId/void",
  asyncHandler(async (req, res) => {
    const expenseId = parsePositiveInt(req.params.expenseId);
    const membership = await inLockedGroup(req, async (client, m) => {
      if (!expenseId) throw new HttpError(404, "Expense not found.");
      const r = await client.query(
        "SELECT id, payer_member_id, voided_at FROM expenses WHERE id = $1 AND group_id = $2",
        [expenseId, m.group_id]
      );
      const expense = r.rows[0];
      if (!expense) throw new HttpError(404, "Expense not found.");
      if (expense.payer_member_id !== m.member_id) {
        throw new HttpError(403, "Only the person who paid can void an expense.");
      }
      if (expense.voided_at) throw new HttpError(409, "That expense is already voided.");

      // Someone who has left settled up at a zero balance; changing an
      // expense they were part of would hand them a debt they can't see.
      const departed = await client.query(
        `SELECT 1 FROM expense_shares s JOIN members mm ON mm.id = s.member_id
         WHERE s.expense_id = $1 AND s.status = 'accepted' AND mm.left_at IS NOT NULL LIMIT 1`,
        [expenseId]
      );
      if (departed.rows.length) {
        throw new HttpError(409, "Someone on this expense has left the tab, so it can't be voided.");
      }

      await client.query("UPDATE expenses SET voided_at = now(), voided_by_member_id = $1 WHERE id = $2", [
        m.member_id,
        expenseId,
      ]);
      return m;
    });
    await sendState(res, membership, req.user.id);
  })
);

// Answer for YOUR share of someone else's expense.
//   accept  — from pending, or from declined (giving way in a dispute)
//   decline — from pending. Declining doesn't end anything: it opens a dispute
//             that's visible to everyone and stops BOTH of you leaving the tab
//             until you accept after all or the payer withdraws the charge.
router.post(
  "/:groupId/expenses/:expenseId/:action(accept|decline)",
  asyncHandler(async (req, res) => {
    const expenseId = parsePositiveInt(req.params.expenseId);
    const accept = req.params.action === "accept";
    const membership = await inLockedGroup(req, async (client, m) => {
      if (!expenseId) throw new HttpError(404, "Expense not found.");
      const r = await client.query(
        `SELECT s.status, e.voided_at FROM expense_shares s JOIN expenses e ON e.id = s.expense_id
         WHERE s.expense_id = $1 AND s.group_id = $2 AND s.member_id = $3`,
        [expenseId, m.group_id, m.member_id]
      );
      const share = r.rows[0];
      if (!share) throw new HttpError(404, "You don't have a share in that expense.");
      if (share.voided_at) throw new HttpError(409, "That expense has been voided.");
      const allowedFrom = accept ? ["pending", "declined"] : ["pending"];
      if (!allowedFrom.includes(share.status)) {
        throw new HttpError(409, `That share is already ${share.status}.`);
      }
      await client.query(
        "UPDATE expense_shares SET status = $1, responded_at = now() WHERE expense_id = $2 AND member_id = $3",
        [accept ? "accepted" : "declined", expenseId, m.member_id]
      );
      return m;
    });
    await sendState(res, membership, req.user.id);
  })
);

// The payer drops their charge to one person (pending or disputed). This only
// ever lowers what that person owes, so it's the payer's call alone.
router.post(
  "/:groupId/expenses/:expenseId/shares/:memberId/withdraw",
  asyncHandler(async (req, res) => {
    const expenseId = parsePositiveInt(req.params.expenseId);
    const memberId = parsePositiveInt(req.params.memberId);
    const membership = await inLockedGroup(req, async (client, m) => {
      if (!expenseId || !memberId) throw new HttpError(404, "Expense not found.");
      const r = await client.query(
        `SELECT s.status, e.voided_at, e.payer_member_id FROM expense_shares s JOIN expenses e ON e.id = s.expense_id
         WHERE s.expense_id = $1 AND s.group_id = $2 AND s.member_id = $3`,
        [expenseId, m.group_id, memberId]
      );
      const share = r.rows[0];
      if (!share) throw new HttpError(404, "Expense not found.");
      if (share.payer_member_id !== m.member_id) throw new HttpError(403, "Only the person who paid can withdraw a charge.");
      if (share.voided_at) throw new HttpError(409, "That expense has been voided.");
      if (share.status !== "pending" && share.status !== "declined") {
        throw new HttpError(409, `That share is ${share.status}, so there's nothing to withdraw.`);
      }
      await client.query(
        "UPDATE expense_shares SET status = 'withdrawn', responded_at = now() WHERE expense_id = $1 AND member_id = $2",
        [expenseId, memberId]
      );
      return m;
    });
    await sendState(res, membership, req.user.id);
  })
);

// ── Repayments ───────────────────────────────────────────────────────────
// "They paid me"  → counts immediately (you're the one giving up the claim).
// "I paid them"   → pending until THEY confirm they received it.
// So nobody can wipe their own debt just by saying they paid.

router.post(
  "/:groupId/payments",
  asyncHandler(async (req, res) => {
    const membership = await inLockedGroup(req, async (client, m) => {
      const members = await loadMembers(client, m.group_id);
      const activeIds = new Set(members.filter((x) => !x.left_at).map((x) => x.id));
      const input = validatePaymentInput(req.body, m.member_id, activeIds);
      if (input.error) throw new HttpError(400, input.error);

      const total = await client.query("SELECT count(*)::int AS n FROM payments WHERE group_id = $1", [m.group_id]);
      if (total.rows[0].n >= MAX_PAYMENTS_PER_GROUP) {
        throw new HttpError(400, "This tab has reached its limit of payments. Start a new tab.");
      }

      if (input.direction === "sent") {
        const pending = await client.query(
          "SELECT count(*)::int AS n FROM payments WHERE group_id = $1 AND recorded_by_member_id = $2 AND status = 'pending'",
          [m.group_id, m.member_id]
        );
        if (pending.rows[0].n >= MAX_PENDING_PAYMENTS_PER_MEMBER) {
          throw new HttpError(400, "You have too many payments waiting for confirmation.");
        }
        await client.query(
          `INSERT INTO payments (group_id, from_member_id, to_member_id, amount_cents, recorded_by_member_id, status)
           VALUES ($1, $2, $3, $4, $2, 'pending')`,
          [m.group_id, m.member_id, input.counterpartyId, input.amountCents]
        );
      } else {
        await client.query(
          `INSERT INTO payments (group_id, from_member_id, to_member_id, amount_cents, recorded_by_member_id, status,
                                 resolved_at, resolved_by_member_id)
           VALUES ($1, $2, $3, $4, $3, 'confirmed', now(), $3)`,
          [m.group_id, input.counterpartyId, m.member_id, input.amountCents]
        );
      }
      return m;
    });
    await sendState(res, membership, req.user.id, 201);
  })
);

// Who may move a payment from one status to another:
//   confirm / decline — the RECEIVER, while it's pending (it lowers their balance)
//   cancel            — whoever recorded it, while it's pending
//   void              — undoes a confirmed payment, which RAISES the payer's
//                       debt again. So: the payer, any time; the receiver only
//                       within a short grace period (to fix a typo) — never
//                       later, so a settled debt can't be quietly re-opened.
const RECEIVER_UNDO_MINUTES = 15;
const PAYMENT_ACTIONS = {
  confirm: { from: "pending", to: "confirmed", actor: "receiver" },
  decline: { from: "pending", to: "declined", actor: "receiver" },
  cancel: { from: "pending", to: "voided", actor: "recorder" },
  void: { from: "confirmed", to: "voided", actor: "payer-or-receiver-in-grace" },
};

router.post(
  "/:groupId/payments/:paymentId/:action",
  asyncHandler(async (req, res) => {
    const rule = Object.prototype.hasOwnProperty.call(PAYMENT_ACTIONS, req.params.action)
      ? PAYMENT_ACTIONS[req.params.action]
      : null;
    if (!rule) throw new HttpError(404, "Not found.");
    const paymentId = parsePositiveInt(req.params.paymentId);

    const membership = await inLockedGroup(req, async (client, m) => {
      if (!paymentId) throw new HttpError(404, "Payment not found.");
      const r = await client.query(
        `SELECT p.*, fm.left_at AS from_left, tm.left_at AS to_left,
                (p.resolved_at > now() - make_interval(mins => $3)) AS in_grace
         FROM payments p
         JOIN members fm ON fm.id = p.from_member_id
         JOIN members tm ON tm.id = p.to_member_id
         WHERE p.id = $1 AND p.group_id = $2`,
        [paymentId, m.group_id, RECEIVER_UNDO_MINUTES]
      );
      const p = r.rows[0];
      if (!p) throw new HttpError(404, "Payment not found.");

      let allowed;
      let refusal;
      if (rule.actor === "receiver") {
        allowed = p.to_member_id === m.member_id;
        refusal = "Only the person who received this payment can do that.";
      } else if (rule.actor === "recorder") {
        allowed = p.recorded_by_member_id === m.member_id;
        refusal = "Only the person who recorded this payment can cancel it.";
      } else {
        allowed = p.from_member_id === m.member_id || (p.to_member_id === m.member_id && p.in_grace);
        refusal =
          p.to_member_id === m.member_id
            ? `A confirmed payment can only be undone by the receiver within ${RECEIVER_UNDO_MINUTES} minutes. After that, only the person who paid can undo it.`
            : "Only the person who paid can undo this payment.";
      }
      if (!allowed) throw new HttpError(403, refusal);
      if (p.status !== rule.from) throw new HttpError(409, `That payment is ${p.status}, so it can't be changed that way.`);
      if (p.from_left || p.to_left) throw new HttpError(409, "Someone on this payment has left the tab.");

      await client.query(
        "UPDATE payments SET status = $1, resolved_at = now(), resolved_by_member_id = $2 WHERE id = $3",
        [rule.to, m.member_id, paymentId]
      );
      return m;
    });
    await sendState(res, membership, req.user.id);
  })
);

// ── Membership ───────────────────────────────────────────────────────────

// You can only leave once you're square: zero balance and no payments still
// waiting on anyone. You can't walk away from what you owe (or are owed).
router.post(
  "/:groupId/leave",
  asyncHandler(async (req, res) => {
    await inLockedGroup(req, async (client, m) => {
      if (m.owner_id === req.user.id) throw new HttpError(400, "The tab's owner can't leave it.");
      await assertSettled(client, m.group_id, m.member_id, "You");
      await client.query("UPDATE members SET left_at = now() WHERE id = $1", [m.member_id]);
    });
    res.json({ left: true });
  })
);

router.post(
  "/:groupId/members/:memberId/remove",
  asyncHandler(async (req, res) => {
    const targetId = parsePositiveInt(req.params.memberId);
    const membership = await inLockedGroup(req, async (client, m) => {
      if (m.owner_id !== req.user.id) throw new HttpError(403, "Only the tab's owner can remove people.");
      const r = await client.query(
        "SELECT id, user_id FROM members WHERE id = $1 AND group_id = $2 AND left_at IS NULL",
        [targetId, m.group_id]
      );
      const target = r.rows[0];
      if (!target) throw new HttpError(404, "That person isn't in this tab.");
      if (target.user_id === req.user.id) throw new HttpError(400, "You can't remove yourself.");
      await assertSettled(client, m.group_id, target.id, "They");
      await client.query("UPDATE members SET left_at = now() WHERE id = $1", [target.id]);
      return m;
    });
    await sendState(res, membership, req.user.id);
  })
);

async function assertSettled(client, groupId, memberId, who) {
  const net = await memberNet(client, groupId, memberId);
  if (net !== 0) {
    throw new HttpError(409, `${who} still ${net < 0 ? "owe" : "are owed"} money in this tab — settle up first.`);
  }
  if (await hasPendingItems(client, groupId, memberId)) {
    throw new HttpError(
      409,
      `${who} have a charge or payment still waiting for an answer, or a disputed charge — resolve it first.`
    );
  }
}

// ── Invites & join requests (owner only) ───────────────────────────────

router.post(
  "/:groupId/invite/:action",
  asyncHandler(async (req, res) => {
    const action = req.params.action;
    if (action !== "regenerate" && action !== "disable") throw new HttpError(404, "Not found.");
    const membership = await inLockedGroup(req, async (client, m) => {
      if (m.owner_id !== req.user.id) throw new HttpError(403, "Only the tab's owner can manage the invite link.");
      const token = action === "regenerate" ? newInviteToken() : null;
      await client.query("UPDATE groups SET invite_token = $1 WHERE id = $2", [token, m.group_id]);
      return { ...m, invite_token: token };
    });
    await sendState(res, membership, req.user.id);
  })
);

router.post(
  "/:groupId/requests/:userId/:action",
  asyncHandler(async (req, res) => {
    const action = req.params.action;
    if (action !== "approve" && action !== "decline") throw new HttpError(404, "Not found.");
    const userId = parsePositiveInt(req.params.userId);

    const membership = await inLockedGroup(req, async (client, m) => {
      if (m.owner_id !== req.user.id) throw new HttpError(403, "Only the tab's owner can approve people.");
      const del = await client.query(
        "DELETE FROM join_requests WHERE group_id = $1 AND user_id = $2 RETURNING user_id",
        [m.group_id, userId]
      );
      if (!del.rows.length) throw new HttpError(404, "That request no longer exists.");

      if (action === "approve") {
        const count = await client.query(
          "SELECT count(*)::int AS n FROM members WHERE group_id = $1 AND left_at IS NULL",
          [m.group_id]
        );
        if (count.rows[0].n >= MAX_GROUP_MEMBERS) {
          throw new HttpError(400, `A tab can have at most ${MAX_GROUP_MEMBERS} people.`);
        }
        await client.query("SELECT 1 FROM users WHERE id = $1 FOR UPDATE", [userId]);
        if ((await activeMembershipCount(client, userId)) >= MAX_GROUPS_PER_USER) {
          throw new HttpError(400, "That person is already in the maximum number of tabs.");
        }
        // Rejoining after leaving reuses their old member row, so their past
        // history stays attached to them.
        await client.query(
          `INSERT INTO members (group_id, user_id) VALUES ($1, $2)
           ON CONFLICT (group_id, user_id) DO UPDATE SET left_at = NULL, joined_at = now()
           WHERE members.left_at IS NOT NULL`,
          [m.group_id, userId]
        );
      }
      return m;
    });
    await sendState(res, membership, req.user.id);
  })
);

module.exports = router;
