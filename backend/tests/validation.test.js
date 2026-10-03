const {
  cleanText,
  isUuid,
  isInviteToken,
  parsePositiveInt,
  validateSignup,
  validateLogin,
  validateGroupName,
  validateExpenseInput,
  validatePaymentInput,
} = require("../lib/validation");

describe("cleanText", () => {
  it("strips control characters, zero-width characters and bidi overrides", () => {
    // U+202E (right-to-left override) can make "Taxi 05$" render as "$50 ixaT".
    expect(cleanText(`Taxi${String.fromCharCode(0x202e)} 05$`)).toBe("Taxi 05$");
    expect(cleanText(`Din${String.fromCharCode(0x200b)}ner${String.fromCharCode(7)}`)).toBe("Dinner");
    expect(cleanText("  lots   of\n\tspace ")).toBe("lots of space");
  });
  it("returns '' for non-strings", () => {
    expect(cleanText(42)).toBe("");
    expect(cleanText({ toString: () => "x" })).toBe("");
  });
});

describe("id/token parsers", () => {
  it("accepts only well-formed UUIDs", () => {
    expect(isUuid("3f2b8c1e-9a4d-4e2f-8b1a-0c9d8e7f6a5b")).toBe(true);
    expect(isUuid("1")).toBe(false);
    expect(isUuid("' OR 1=1 --")).toBe(false);
  });
  it("accepts only 32-char base64url invite tokens", () => {
    expect(isInviteToken("A".repeat(32))).toBe(true);
    expect(isInviteToken("A".repeat(31))).toBe(false);
    expect(isInviteToken("A".repeat(31) + "/")).toBe(false);
  });
  it("parses positive int ids strictly", () => {
    expect(parsePositiveInt("12")).toBe(12);
    expect(parsePositiveInt(12)).toBe(12);
    for (const bad of ["0", "-1", "1.5", "1e3", "12abc", "", null, undefined, 1.5, "9999999999"]) {
      expect(parsePositiveInt(bad)).toBeNull();
    }
  });
});

describe("validateSignup", () => {
  const good = { email: " Ama@Example.com ", display_name: "Ama", password: "correct horse battery" };
  it("normalises email and accepts a good signup", () => {
    expect(validateSignup(good)).toEqual({ email: "ama@example.com", displayName: "Ama", password: good.password });
  });
  it("reserves names that could impersonate the viewer or the UI's own labels", () => {
    const cyrillicO = String.fromCharCode(0x043e);
    const fullwidthYou = [0xff59, 0xff4f, 0xff55].map((c) => String.fromCharCode(c)).join("");
    for (const display_name of ["you", "You", " YOU ", "me", "Ama (2)", "Kwesi ★", "<b>x</b>", `y${cyrillicO}u`, fullwidthYou]) {
      expect(validateSignup({ ...good, display_name }).error).toBeDefined();
    }
  });

  it("still accepts real names in any single alphabet", () => {
    for (const display_name of ["Ama", "José", "Ерлан", "Γιώργος", "小明", "Ama-Kofi", "O'Neil"]) {
      expect(validateSignup({ ...good, display_name }).error).toBeUndefined();
    }
  });

  it("rejects bad emails, names and weak/oversized passwords", () => {
    expect(validateSignup({ ...good, email: "nope" }).error).toBeDefined();
    expect(validateSignup({ ...good, display_name: "   " }).error).toBeDefined();
    expect(validateSignup({ ...good, password: "short" }).error).toBeDefined();
    expect(validateSignup({ ...good, password: "x".repeat(201) }).error).toBeDefined();
    expect(validateSignup({ ...good, password: ["array"] }).error).toBeDefined();
    expect(validateSignup({ ...good, password: "ama@example.com" }).error).toBeDefined();
  });
});

describe("validateLogin", () => {
  it("gives the same generic message for every malformed input", () => {
    expect(validateLogin({}).error).toBe("Email or password is incorrect.");
    expect(validateLogin({ email: "a@b.co", password: { $ne: null } }).error).toBe("Email or password is incorrect.");
  });
});

describe("validateGroupName", () => {
  it("enforces 2–80 characters after cleaning", () => {
    expect(validateGroupName({ name: " Trip " })).toEqual({ name: "Trip", currency: "GHS" });
    expect(validateGroupName({ name: "Trip", currency: "USD" })).toEqual({ name: "Trip", currency: "USD" });
    for (const bad of ["EUR", "ghs", "", null, 5, {}, ["GHS"]]) {
      expect(validateGroupName({ name: "Trip", currency: bad }).error).toBeDefined();
    }
    expect(validateGroupName({ name: "a" }).error).toBeDefined();
    expect(validateGroupName({ name: "x".repeat(81) }).error).toBeDefined();
  });
});

describe("validateExpenseInput", () => {
  const active = new Set([1, 2, 3]);
  it("never takes a payer from the request", () => {
    const r = validateExpenseInput({ description: "Dinner", amount: "30", participant_ids: [3, 1, 1], payer_id: 2 }, active);
    expect(r).toEqual({ description: "Dinner", amountCents: 3000, participantIds: [1, 3] });
    expect(r.payerId).toBeUndefined();
  });
  it("rejects participants outside the tab", () => {
    expect(validateExpenseInput({ description: "x", amount: "1", participant_ids: [1, 99] }, active).error).toBeDefined();
  });
  it("requires an explicit, non-empty participant list", () => {
    expect(validateExpenseInput({ description: "x", amount: "1" }, active).error).toBeDefined();
    expect(validateExpenseInput({ description: "x", amount: "1", participant_ids: [] }, active).error).toBeDefined();
  });
  it("rejects amounts too small to give everyone at least a cent", () => {
    expect(validateExpenseInput({ description: "x", amount: "0.02", participant_ids: [1, 2, 3] }, active).error).toMatch(/at least 0\.01/);
    expect(validateExpenseInput({ description: "x", amount: "0.03", participant_ids: [1, 2, 3] }, active).error).toBeUndefined();
  });
  it("rejects negative, zero, huge and malformed amounts", () => {
    for (const amount of ["-5", "0", "0.00", "1000000.01", "1.234", "abc", "1e5", null, 5, 12.345]) {
      expect(validateExpenseInput({ description: "x", amount, participant_ids: [1] }, active).error).toBeDefined();
    }
  });
});

describe("validatePaymentInput", () => {
  const active = new Set([1, 2]);
  it("accepts sent/received to another current member", () => {
    expect(validatePaymentInput({ direction: "sent", counterparty_id: 2, amount: "5" }, 1, active)).toEqual({
      direction: "sent",
      counterpartyId: 2,
      amountCents: 500,
    });
  });
  it("rejects paying yourself, unknown people, bad directions and bad amounts", () => {
    expect(validatePaymentInput({ direction: "sent", counterparty_id: 1, amount: "5" }, 1, active).error).toBeDefined();
    expect(validatePaymentInput({ direction: "sent", counterparty_id: 9, amount: "5" }, 1, active).error).toBeDefined();
    expect(validatePaymentInput({ direction: "gift", counterparty_id: 2, amount: "5" }, 1, active).error).toBeDefined();
    expect(validatePaymentInput({ direction: "sent", counterparty_id: 2, amount: "-5" }, 1, active).error).toBeDefined();
  });
});
