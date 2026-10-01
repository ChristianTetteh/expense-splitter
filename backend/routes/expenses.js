const express = require("express");
const pool = require("../db");

const router = express.Router();

// Delete an expense (and its participant splits, via ON DELETE CASCADE).
// There's no login system here — same as the rest of this app, access
// control is "you have the group's link" — so this is scoped only to
// making sure the expense actually exists, not to who's asking.
router.delete("/:id", async (req, res) => {
  const expenseId = Number(req.params.id);
  if (!Number.isInteger(expenseId) || expenseId <= 0) {
    return res.status(400).json({ error: "Invalid expense id." });
  }

  try {
    const result = await pool.query("DELETE FROM expenses WHERE id = $1 RETURNING id", [expenseId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Expense not found." });
    }
    res.json({ deleted: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not delete the expense." });
  }
});

module.exports = router;
