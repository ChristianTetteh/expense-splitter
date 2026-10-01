const { validateGroupInput, validateNewMember, validateExpenseInput } = require("../lib/validation");

describe("validateGroupInput", () => {
  it("accepts a valid group and trims/cleans names", () => {
    const result = validateGroupInput({ name: "  Accra Trip  ", members: ["  Ama  ", "Kwesi"] });
    expect(result.error).toBeUndefined();
    expect(result.name).toBe("Accra Trip");
    expect(result.members).toEqual(["Ama", "Kwesi"]);
  });

  it("rejects a name that's too short or too long", () => {
    expect(validateGroupInput({ name: "A", members: ["Ama", "Kwesi"] }).error).toBeTruthy();
    expect(validateGroupInput({ name: "x".repeat(81), members: ["Ama", "Kwesi"] }).error).toBeTruthy();
  });

  it("rejects fewer than 2 members", () => {
    expect(validateGroupInput({ name: "Trip", members: [] }).error).toBeTruthy();
    expect(validateGroupInput({ name: "Trip", members: ["Ama"] }).error).toBeTruthy();
  });

  it("rejects more than the max member count", () => {
    const members = Array.from({ length: 31 }, (_, i) => `Member${i}`);
    expect(validateGroupInput({ name: "Trip", members }).error).toBeTruthy();
  });

  it("rejects duplicate member names, case-insensitively", () => {
    expect(validateGroupInput({ name: "Trip", members: ["Ama", "ama"] }).error).toBeTruthy();
  });

  it("rejects a blank member name", () => {
    expect(validateGroupInput({ name: "Trip", members: ["Ama", "   "] }).error).toBeTruthy();
  });
});

describe("validateNewMember", () => {
  it("accepts a new, non-duplicate name", () => {
    const result = validateNewMember({ name: "Efua" }, new Set(["ama", "kwesi"]));
    expect(result.name).toBe("Efua");
  });

  it("rejects a name already in the group, case-insensitively", () => {
    expect(validateNewMember({ name: "AMA" }, new Set(["ama"])).error).toBeTruthy();
  });
});

describe("validateExpenseInput", () => {
  const memberIds = new Set([1, 2, 3]);

  it("accepts a valid expense and defaults participants to the whole group", () => {
    const result = validateExpenseInput({ description: "Dinner", amount: "30.00", payer_id: 1 }, memberIds);
    expect(result.error).toBeUndefined();
    expect(result.description).toBe("Dinner");
    expect(result.amountCents).toBe(3000);
    expect(result.payerId).toBe(1);
    expect(result.participantIds.sort()).toEqual([1, 2, 3]);
  });

  it("accepts an explicit, smaller participant list", () => {
    const result = validateExpenseInput(
      { description: "Taxi", amount: "15", payer_id: 2, participant_ids: [2, 3] },
      memberIds
    );
    expect(result.participantIds).toEqual([2, 3]);
  });

  it("rejects an empty description", () => {
    expect(validateExpenseInput({ description: "  ", amount: "10", payer_id: 1 }, memberIds).error).toBeTruthy();
  });

  it("rejects an invalid amount", () => {
    expect(validateExpenseInput({ description: "X", amount: "0", payer_id: 1 }, memberIds).error).toBeTruthy();
    expect(validateExpenseInput({ description: "X", amount: "abc", payer_id: 1 }, memberIds).error).toBeTruthy();
  });

  it("rejects a payer who isn't in the group", () => {
    expect(validateExpenseInput({ description: "X", amount: "10", payer_id: 99 }, memberIds).error).toBeTruthy();
  });

  it("rejects an empty participant list", () => {
    expect(
      validateExpenseInput({ description: "X", amount: "10", payer_id: 1, participant_ids: [] }, memberIds).error
    ).toBeTruthy();
  });

  it("rejects a participant who isn't in the group", () => {
    expect(
      validateExpenseInput({ description: "X", amount: "10", payer_id: 1, participant_ids: [1, 99] }, memberIds)
        .error
    ).toBeTruthy();
  });
});
