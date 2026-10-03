const { isUuid } = require("./validation");
const { computeBalances, computeSettlement } = require("./settlement");

// Looks up the caller's ACTIVE membership in a tab. Returns null for a
// malformed id, a tab that doesn't exist, a tab they were never in, or one
// they've left — callers answer all of those with the same 404, so the API
// never reveals whether a tab they can't see exists.
//
// With { lock: true } (inside a transaction) it first takes a row lock on the
// tab, serialising every write that can move money in that tab. That's what
// makes checks like "your balance is zero, so you may leave" safe: no other
// expense or payment can land between the check and the write.
const MEMBERSHIP_SQL = `SELECT m.id AS member_id, g.id AS group_id, g.name, g.currency, g.owner_id, g.invite_token, g.created_at
  FROM members m JOIN groups g ON g.id = m.group_id
  WHERE m.group_id = $1 AND m.user_id = $2 AND m.left_at IS NULL`;

async function getMembership(db, groupId, userId, { lock = false } = {}) {
  if (!isUuid(groupId)) return null;
  const first = await db.query(MEMBERSHIP_SQL, [groupId, userId]);
  if (!first.rows[0] || !lock) return first.rows[0] || null;
  // Only members ever get to take the lock (so an outsider can't stall a
  // tab, or time how long a lock takes, to learn that it exists). Membership
  // is re-read under the lock in case they were removed in the meantime.
  await db.query("SELECT 1 FROM groups WHERE id = $1 FOR UPDATE", [groupId]);
  const locked = await db.query(MEMBERSHIP_SQL, [groupId, userId]);
  return locked.rows[0] || null;
}

// Two people in a tab may share a display name; add " (2)", " (3)" … in join
// order so nobody can be mistaken for someone else in the history.
function labelMembers(rows) {
  const counts = new Map();
  for (const r of rows) counts.set(r.display_name.toLowerCase(), (counts.get(r.display_name.toLowerCase()) || 0) + 1);
  const seen = new Map();
  return rows.map((r) => {
    const key = r.display_name.toLowerCase();
    const n = (seen.get(key) || 0) + 1;
    seen.set(key, n);
    return { ...r, name: counts.get(key) > 1 && n > 1 ? `${r.display_name} (${n})` : r.display_name };
  });
}

async function loadMembers(db, groupId) {
  const result = await db.query(
    `SELECT m.id, m.user_id, m.joined_at, m.left_at, u.display_name
     FROM members m JOIN users u ON u.id = m.user_id
     WHERE m.group_id = $1
     ORDER BY m.joined_at ASC, m.id ASC`,
    [groupId]
  );
  return labelMembers(result.rows);
}

// Balances count only what's actually in force: expenses that haven't been
// voided, and payments the receiver has confirmed.
async function loadBalances(db, groupId, members) {
  // Sequential on purpose: `db` is often a single transaction client.
  // An expense only moves money for the shares that have been ACCEPTED, so
  // the payer is credited with exactly those shares — pending or declined
  // ones have no effect on anyone. (The payer's own share is pre-accepted
  // and nets out: they paid it and they owe it.)
  const expenses = await db.query(
    `SELECT e.payer_member_id AS payer_id, sum(s.share_cents)::int AS amount_cents
     FROM expenses e JOIN expense_shares s ON s.expense_id = e.id
     WHERE e.group_id = $1 AND e.voided_at IS NULL AND s.status = 'accepted'
     GROUP BY e.id, e.payer_member_id`,
    [groupId]
  );
  const shares = await db.query(
    `SELECT s.member_id, s.share_cents FROM expense_shares s
     JOIN expenses e ON e.id = s.expense_id
     WHERE s.group_id = $1 AND e.voided_at IS NULL AND s.status = 'accepted'`,
    [groupId]
  );
  const payments = await db.query(
    "SELECT from_member_id, to_member_id, amount_cents FROM payments WHERE group_id = $1 AND status = 'confirmed'",
    [groupId]
  );
  return computeBalances(members, expenses.rows, shares.rows, payments.rows);
}

async function memberNet(db, groupId, memberId) {
  const members = await loadMembers(db, groupId);
  const balances = await loadBalances(db, groupId, members);
  const mine = balances.find((b) => b.memberId === memberId);
  return mine ? mine.netCents : 0;
}

// Anything still unresolved that involves this member: a pending payment
// either side of, or a charge to/from them that's pending or DISPUTED
// (declined but not withdrawn). These all block leaving.
async function hasPendingItems(db, groupId, memberId) {
  const result = await db.query(
    `SELECT 1 FROM payments
       WHERE group_id = $1 AND status = 'pending' AND (from_member_id = $2 OR to_member_id = $2)
     UNION ALL
     SELECT 1 FROM expense_shares s JOIN expenses e ON e.id = s.expense_id
       WHERE s.group_id = $1 AND s.status IN ('pending', 'declined') AND e.voided_at IS NULL
         AND (s.member_id = $2 OR e.payer_member_id = $2)
     LIMIT 1`,
    [groupId, memberId]
  );
  return result.rows.length > 0;
}

// Everything the tab page shows, from the point of view of `membership`.
async function loadGroupState(db, membership, userId) {
  const groupId = membership.group_id;
  const isOwner = membership.owner_id === userId;
  const members = await loadMembers(db, groupId);
  const nameOf = new Map(members.map((m) => [m.id, m.name]));

  const [expenseResult, shareResult, paymentResult, requestResult] = await Promise.all([
    db.query(
      `SELECT id, payer_member_id, description, amount_cents, created_at, voided_at, voided_by_member_id
       FROM expenses WHERE group_id = $1 ORDER BY created_at DESC, id DESC`,
      [groupId]
    ),
    db.query("SELECT expense_id, member_id, share_cents, status, responded_at FROM expense_shares WHERE group_id = $1", [groupId]),
    db.query(
      `SELECT id, from_member_id, to_member_id, amount_cents, recorded_by_member_id, status,
              created_at, resolved_at, resolved_by_member_id
       FROM payments WHERE group_id = $1 ORDER BY created_at DESC, id DESC`,
      [groupId]
    ),
    isOwner
      ? db.query(
          `SELECT jr.user_id, u.display_name, u.email, jr.requested_at
           FROM join_requests jr JOIN users u ON u.id = jr.user_id
           WHERE jr.group_id = $1 ORDER BY jr.requested_at ASC`,
          [groupId]
        )
      : Promise.resolve({ rows: [] }),
  ]);

  const sharesByExpense = new Map();
  for (const s of shareResult.rows) {
    if (!sharesByExpense.has(s.expense_id)) sharesByExpense.set(s.expense_id, []);
    sharesByExpense.get(s.expense_id).push({
      member_id: s.member_id,
      name: nameOf.get(s.member_id),
      share_cents: s.share_cents,
      status: s.status,
      responded_at: s.responded_at,
    });
  }

  const balances = await loadBalances(db, groupId, members);
  const activeIds = new Set(members.filter((m) => !m.left_at).map((m) => m.id));

  return {
    group: {
      id: groupId,
      name: membership.name,
      currency: membership.currency,
      created_at: membership.created_at,
      is_owner: isOwner,
      // The invite token is only ever shown to the owner.
      invite_token: isOwner ? membership.invite_token : undefined,
    },
    me: { member_id: membership.member_id },
    members: members.map((m) => ({
      id: m.id,
      name: m.name,
      is_owner: m.user_id === membership.owner_id,
      is_me: m.id === membership.member_id,
      joined_at: m.joined_at,
      left_at: m.left_at,
    })),
    // The owner sees each requester's email as well as their name, so a
    // stranger can't pass themselves off as a friend just by picking the
    // same display name.
    join_requests: requestResult.rows.map((r) => ({
      user_id: r.user_id,
      name: r.display_name,
      email: r.email,
      requested_at: r.requested_at,
    })),
    expenses: expenseResult.rows.map((e) => ({
      id: e.id,
      description: e.description,
      amount_cents: e.amount_cents,
      created_at: e.created_at,
      payer_id: e.payer_member_id,
      payer_name: nameOf.get(e.payer_member_id),
      voided_at: e.voided_at,
      voided_by_name: e.voided_by_member_id ? nameOf.get(e.voided_by_member_id) : null,
      shares: (sharesByExpense.get(e.id) || []).sort((a, b) => a.member_id - b.member_id),
    })),
    payments: paymentResult.rows.map((p) => ({
      id: p.id,
      from_id: p.from_member_id,
      from_name: nameOf.get(p.from_member_id),
      to_id: p.to_member_id,
      to_name: nameOf.get(p.to_member_id),
      amount_cents: p.amount_cents,
      recorded_by_id: p.recorded_by_member_id,
      status: p.status,
      created_at: p.created_at,
      resolved_at: p.resolved_at,
      resolved_by_name: p.resolved_by_member_id ? nameOf.get(p.resolved_by_member_id) : null,
    })),
    balances: balances.filter((b) => activeIds.has(b.memberId) || b.netCents !== 0),
    settlement: computeSettlement(balances),
  };
}

module.exports = { getMembership, loadMembers, loadBalances, memberNet, hasPendingItems, loadGroupState };
