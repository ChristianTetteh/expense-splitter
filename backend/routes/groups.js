const express = require("express");
const pool = require("../db");
const { splitEvenly } = require("../lib/money");
const { validateGroupInput, validateNewMember, validateExpenseInput } = require("../lib/validation");
const { computeBalances, computeSettlement } = require("../lib/settlement");

const router = express.Router();

function parseGroupId(raw) {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// Create a group with its starting roster. Group + members are inserted in
// one transaction so a crash partway through can never leave a group with
// zero members sitting in the database.
router.post("/", async (req, res) => {
  const { name, members, error } = validateGroupInput(req.body);
  if (error) return res.status(400).json({ error });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const groupResult = await client.query(
      "INSERT INTO groups (name) VALUES ($1) RETURNING id, name, created_at",
      [name]
    );
    const group = groupResult.rows[0];

    const memberRows = [];
    for (const memberName of members) {
      const result = await client.query(
        "INSERT INTO members (group_id, name) VALUES ($1, $2) RETURNING id, name",
        [group.id, memberName]
      );
      memberRows.push(result.rows[0]);
    }

    await client.query("COMMIT");
    res.status(201).json({ group: { ...group, members: memberRows } });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Could not create the group." });
  } finally {
    client.release();
  }
});

router.get("/:id", async (req, res) => {
  const groupId = parseGroupId(req.params.id);
  if (!groupId) return res.status(400).json({ error: "Invalid group id." });

  try {
    const groupResult = await pool.query("SELECT id, name, created_at FROM groups WHERE id = $1", [groupId]);
    if (groupResult.rows.length === 0) return res.status(404).json({ error: "Group not found." });

    const membersResult = await pool.query(
      "SELECT id, name FROM members WHERE group_id = $1 ORDER BY id ASC",
      [groupId]
    );
    res.json({ group: { ...groupResult.rows[0], members: membersResult.rows } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load the group." });
  }
});

router.post("/:id/members", async (req, res) => {
  const groupId = parseGroupId(req.params.id);
  if (!groupId) return res.status(400).json({ error: "Invalid group id." });

  try {
    const groupResult = await pool.query("SELECT id FROM groups WHERE id = $1", [groupId]);
    if (groupResult.rows.length === 0) return res.status(404).json({ error: "Group not found." });

    const existing = await pool.query("SELECT name FROM members WHERE group_id = $1", [groupId]);
    const existingNames = new Set(existing.rows.map((r) => r.name.toLowerCase()));

    const { name, error } = validateNewMember(req.body, existingNames);
    if (error) return res.status(400).json({ error });

    const result = await pool.query(
      "INSERT INTO members (group_id, name) VALUES ($1, $2) RETURNING id, name",
      [groupId, name]
    );
    res.status(201).json({ member: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not add the member." });
  }
});

// Add an expense: who paid, how much, and who it's split between (defaults
// to the whole group). The split is computed once, here, and stored as
// explicit per-person shares (schema.sql) rather than recomputed later —
// see lib/money.js's splitEvenly for how the remainder cent(s) are assigned.
router.post("/:id/expenses", async (req, res) => {
  const groupId = parseGroupId(req.params.id);
  if (!groupId) return res.status(400).json({ error: "Invalid group id." });

  try {
    const groupResult = await pool.query("SELECT id FROM groups WHERE id = $1", [groupId]);
    if (groupResult.rows.length === 0) return res.status(404).json({ error: "Group not found." });

    const membersResult = await pool.query("SELECT id FROM members WHERE group_id = $1", [groupId]);
    const memberIds = new Set(membersResult.rows.map((r) => r.id));

    const { description, amountCents, payerId, participantIds, error } = validateExpenseInput(req.body, memberIds);
    if (error) return res.status(400).json({ error });

    // Stable, deterministic order for the remainder-cent distribution in
    // splitEvenly — sorted by member id rather than whatever order the
    // client happened to send participant_ids in.
    const orderedParticipantIds = [...participantIds].sort((a, b) => a - b);
    const shares = splitEvenly(amountCents, orderedParticipantIds);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const expenseResult = await client.query(
        `INSERT INTO expenses (group_id, payer_id, description, amount_cents)
         VALUES ($1, $2, $3, $4)
         RETURNING id, description, amount_cents, created_at`,
        [groupId, payerId, description, amountCents]
      );
      const expense = expenseResult.rows[0];

      for (const [memberId, shareCents] of shares) {
        await client.query(
          "INSERT INTO expense_participants (expense_id, member_id, share_cents) VALUES ($1, $2, $3)",
          [expense.id, memberId, shareCents]
        );
      }

      await client.query("COMMIT");
      res.status(201).json({
        expense: {
          ...expense,
          group_id: groupId,
          payer_id: payerId,
          participants: orderedParticipantIds.map((memberId) => ({ member_id: memberId, share_cents: shares.get(memberId) })),
        },
      });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not add the expense." });
  }
});

// Full expense history for a group, newest first, each with the payer's
// name and the per-person split already resolved to names — the frontend
// shouldn't have to cross-reference member ids itself.
router.get("/:id/expenses", async (req, res) => {
  const groupId = parseGroupId(req.params.id);
  if (!groupId) return res.status(400).json({ error: "Invalid group id." });

  try {
    const groupResult = await pool.query("SELECT id FROM groups WHERE id = $1", [groupId]);
    if (groupResult.rows.length === 0) return res.status(404).json({ error: "Group not found." });

    const expensesResult = await pool.query(
      `SELECT e.id, e.description, e.amount_cents, e.created_at, e.payer_id, m.name AS payer_name
       FROM expenses e
       JOIN members m ON m.id = e.payer_id
       WHERE e.group_id = $1
       ORDER BY e.created_at DESC, e.id DESC`,
      [groupId]
    );
    const expenses = expensesResult.rows;
    if (expenses.length === 0) return res.json({ expenses: [] });

    const participantsResult = await pool.query(
      `SELECT ep.expense_id, ep.member_id, ep.share_cents, m.name
       FROM expense_participants ep
       JOIN members m ON m.id = ep.member_id
       WHERE ep.expense_id = ANY($1::int[])`,
      [expenses.map((e) => e.id)]
    );
    const participantsByExpense = new Map();
    for (const row of participantsResult.rows) {
      if (!participantsByExpense.has(row.expense_id)) participantsByExpense.set(row.expense_id, []);
      participantsByExpense.get(row.expense_id).push({ member_id: row.member_id, name: row.name, share_cents: row.share_cents });
    }

    res.json({
      expenses: expenses.map((e) => ({ ...e, participants: participantsByExpense.get(e.id) || [] })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load expense history." });
  }
});

// Each member's net balance, plus a minimal set of payments that would
// settle the group to zero — see lib/settlement.js for the algorithm.
router.get("/:id/balances", async (req, res) => {
  const groupId = parseGroupId(req.params.id);
  if (!groupId) return res.status(400).json({ error: "Invalid group id." });

  try {
    const membersResult = await pool.query("SELECT id, name FROM members WHERE group_id = $1 ORDER BY id ASC", [groupId]);
    if (membersResult.rows.length === 0) {
      const exists = await pool.query("SELECT id FROM groups WHERE id = $1", [groupId]);
      if (exists.rows.length === 0) return res.status(404).json({ error: "Group not found." });
    }
    const members = membersResult.rows;

    const expensesResult = await pool.query(
      "SELECT payer_id, amount_cents FROM expenses WHERE group_id = $1",
      [groupId]
    );
    const participantsResult = await pool.query(
      `SELECT ep.member_id, ep.share_cents FROM expense_participants ep
       JOIN expenses e ON e.id = ep.expense_id
       WHERE e.group_id = $1`,
      [groupId]
    );

    const balances = computeBalances(members, expensesResult.rows, participantsResult.rows);
    const settlement = computeSettlement(balances);
    res.json({ balances, settlement });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not compute balances." });
  }
});

module.exports = router;
