const { computeBalances, computeSettlement } = require("../lib/settlement");

const members = [
  { id: 1, name: "Ama" },
  { id: 2, name: "Kwesi" },
  { id: 3, name: "Esi" },
];

describe("computeBalances", () => {
  it("nets to zero across the group, always", () => {
    const expenses = [
      { payer_id: 1, amount_cents: 3000 },
      { payer_id: 2, amount_cents: 1500 },
    ];
    const participants = [
      // $30 split 3 ways: 1000/1000/1000
      { member_id: 1, share_cents: 1000 },
      { member_id: 2, share_cents: 1000 },
      { member_id: 3, share_cents: 1000 },
      // $15 split between 2 and 3 only: 750/750
      { member_id: 2, share_cents: 750 },
      { member_id: 3, share_cents: 750 },
    ];

    const balances = computeBalances(members, expenses, participants);
    const total = balances.reduce((sum, b) => sum + b.netCents, 0);
    expect(total).toBe(0);

    const byId = Object.fromEntries(balances.map((b) => [b.memberId, b]));
    expect(byId[1].netCents).toBe(3000 - 1000); // paid 3000, owes 1000
    expect(byId[2].netCents).toBe(1500 - (1000 + 750)); // paid 1500, owes 1750
    expect(byId[3].netCents).toBe(0 - (1000 + 750)); // paid nothing, owes 1750
  });

  it("applies confirmed repayments: the sender's balance rises, the receiver's falls, total stays zero", () => {
    const expenses = [{ payer_id: 1, amount_cents: 3000 }];
    const participants = [
      { member_id: 1, share_cents: 1000 },
      { member_id: 2, share_cents: 1000 },
      { member_id: 3, share_cents: 1000 },
    ];
    // Kwesi pays Ama back in full; Esi pays back half.
    const payments = [
      { from_member_id: 2, to_member_id: 1, amount_cents: 1000 },
      { from_member_id: 3, to_member_id: 1, amount_cents: 500 },
    ];
    const balances = computeBalances(members, expenses, participants, payments);
    const byId = Object.fromEntries(balances.map((b) => [b.memberId, b.netCents]));
    expect(byId).toEqual({ 1: 500, 2: 0, 3: -500 });
    expect(balances.reduce((sum, b) => sum + b.netCents, 0)).toBe(0);
    expect(computeSettlement(balances)).toEqual([
      { fromId: 3, fromName: "Esi", toId: 1, toName: "Ama", amountCents: 500 },
    ]);
  });

  it("gives everyone a zero balance when nothing's been spent", () => {
    const balances = computeBalances(members, [], []);
    expect(balances.every((b) => b.netCents === 0)).toBe(true);
  });

  it("nets a member who both paid and owes for the same set of expenses to zero when they're the only payer and participant", () => {
    const soloMembers = [{ id: 1, name: "Solo" }];
    const balances = computeBalances(
      soloMembers,
      [{ payer_id: 1, amount_cents: 500 }],
      [{ member_id: 1, share_cents: 500 }]
    );
    expect(balances[0].netCents).toBe(0);
  });
});

describe("computeSettlement", () => {
  it("settles a simple two-person debt in one transaction", () => {
    const balances = [
      { memberId: 1, name: "Ama", netCents: 1000 },
      { memberId: 2, name: "Kwesi", netCents: -1000 },
    ];
    const settlement = computeSettlement(balances);
    expect(settlement).toEqual([{ fromId: 2, fromName: "Kwesi", toId: 1, toName: "Ama", amountCents: 1000 }]);
  });

  it("produces no transactions when everyone's already even", () => {
    const balances = [
      { memberId: 1, name: "Ama", netCents: 0 },
      { memberId: 2, name: "Kwesi", netCents: 0 },
    ];
    expect(computeSettlement(balances)).toEqual([]);
  });

  it("never produces more than (nonzero members) - 1 transactions", () => {
    const balances = [
      { memberId: 1, name: "A", netCents: 2000 },
      { memberId: 2, name: "B", netCents: 1000 },
      { memberId: 3, name: "C", netCents: -500 },
      { memberId: 4, name: "D", netCents: -1000 },
      { memberId: 5, name: "E", netCents: -1500 },
    ];
    const settlement = computeSettlement(balances);
    expect(settlement.length).toBeLessThanOrEqual(4);

    // Every transaction actually settles the books: replaying them against
    // the original balances should bring everyone to exactly zero.
    const remaining = Object.fromEntries(balances.map((b) => [b.memberId, b.netCents]));
    for (const t of settlement) {
      remaining[t.fromId] += t.amountCents;
      remaining[t.toId] -= t.amountCents;
    }
    expect(Object.values(remaining).every((v) => v === 0)).toBe(true);
  });

  it("handles an unequal split that doesn't resolve in one pairing", () => {
    // A is owed 1000, covered by B (600) then C (400).
    const balances = [
      { memberId: 1, name: "A", netCents: 1000 },
      { memberId: 2, name: "B", netCents: -600 },
      { memberId: 3, name: "C", netCents: -400 },
    ];
    const settlement = computeSettlement(balances);
    const totalToA = settlement.filter((t) => t.toId === 1).reduce((sum, t) => sum + t.amountCents, 0);
    expect(totalToA).toBe(1000);
    expect(settlement.every((t) => t.amountCents > 0)).toBe(true);
  });
});
