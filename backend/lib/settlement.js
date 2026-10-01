// Turns a group's expenses into (1) each member's net balance and (2) a
// short list of payments that would bring every balance to zero.

// `members` is [{id, name}, ...]. `expenseRows` is [{payer_id, amount_cents}, ...].
// `participantRows` is [{member_id, share_cents}, ...] (one row per person
// per expense they're part of — expense id isn't needed here, only who
// owes how much in total).
//
// Returns [{memberId, name, paidCents, owedCents, netCents}, ...], one per
// member, in the same order as `members`. netCents > 0 means that member is
// owed money overall; netCents < 0 means they owe money overall. The sum of
// every netCents is always exactly 0 — every cent paid is split among some
// set of participants, so total paid === total owed across the group.
function computeBalances(members, expenseRows, participantRows) {
  const paid = new Map(members.map((m) => [m.id, 0]));
  const owed = new Map(members.map((m) => [m.id, 0]));

  for (const row of expenseRows) {
    paid.set(row.payer_id, (paid.get(row.payer_id) || 0) + row.amount_cents);
  }
  for (const row of participantRows) {
    owed.set(row.member_id, (owed.get(row.member_id) || 0) + row.share_cents);
  }

  return members.map((m) => {
    const paidCents = paid.get(m.id) || 0;
    const owedCents = owed.get(m.id) || 0;
    return { memberId: m.id, name: m.name, paidCents, owedCents, netCents: paidCents - owedCents };
  });
}

// Reduces a set of net balances to the smallest-effort set of payments that
// settles every debt, by always matching the person who owes the most
// against the person who's owed the most. This is a greedy heuristic, not
// the mathematically optimal minimum-transaction-count solution (that's an
// NP-hard partition problem) — but it's the same approach Splitwise and
// similar tools use in practice, it never produces more than
// (members with a nonzero balance) - 1 payments, and for the small, mostly-
// two-sided groups this app is built for, it typically matches the optimum.
function computeSettlement(balances) {
  const creditors = balances
    .filter((b) => b.netCents > 0)
    .map((b) => ({ memberId: b.memberId, name: b.name, amountCents: b.netCents }))
    .sort((a, b) => b.amountCents - a.amountCents);
  const debtors = balances
    .filter((b) => b.netCents < 0)
    .map((b) => ({ memberId: b.memberId, name: b.name, amountCents: -b.netCents }))
    .sort((a, b) => b.amountCents - a.amountCents);

  const transactions = [];
  let ci = 0;
  let di = 0;
  while (ci < creditors.length && di < debtors.length) {
    const creditor = creditors[ci];
    const debtor = debtors[di];
    const amount = Math.min(creditor.amountCents, debtor.amountCents);

    if (amount > 0) {
      transactions.push({
        fromId: debtor.memberId,
        fromName: debtor.name,
        toId: creditor.memberId,
        toName: creditor.name,
        amountCents: amount,
      });
    }

    creditor.amountCents -= amount;
    debtor.amountCents -= amount;
    if (creditor.amountCents === 0) ci++;
    if (debtor.amountCents === 0) di++;
  }

  return transactions;
}

module.exports = { computeBalances, computeSettlement };
