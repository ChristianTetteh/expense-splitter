// All money math happens here, in integer cents. Nothing else in the app
// should do arithmetic on dollar amounts directly — floating point dollars
// is how "$10 split 3 ways" silently stops summing to $10.

const MAX_CENTS = 100_000_000; // $1,000,000.00 — generous upper bound, mostly to catch fat-fingered input

// Parses user-supplied dollar input ("12.5", "12.50", 12.5, "$12.50") into
// an integer number of cents, or returns null if it isn't a valid positive
// amount. Rejects more than 2 decimal places rather than silently rounding
// away a typo like "12.455".
function parseDollarsToCents(input) {
  if (typeof input === "number") {
    if (!Number.isFinite(input)) return null;
    input = input.toFixed(2);
  }
  if (typeof input !== "string") return null;

  const trimmed = input.trim().replace(/^\$/, "");
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;

  const [wholePart, fractionPart = ""] = trimmed.split(".");
  const cents = Number(wholePart) * 100 + Number(fractionPart.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > MAX_CENTS) return null;
  return cents;
}

function centsToDollarString(cents) {
  const negative = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const dollars = Math.floor(abs / 100);
  const remainder = String(abs % 100).padStart(2, "0");
  return `${negative ? "-" : ""}${dollars}.${remainder}`;
}

// Splits `totalCents` evenly across `memberIds` (in the given order),
// returning a Map(memberId -> shareCents) whose values sum to *exactly*
// totalCents. Equal integer division leaves a remainder of 1-99 cents for
// most totals/participant counts; that remainder is handed out one cent at
// a time, in order, so e.g. $10.00 / 3 is 334/333/333, not 333.33 repeating.
// The order participants are passed in is what decides who gets the extra
// cent(s) — callers should pass a stable order (e.g. sorted by member id)
// so repeated calls with the same input are deterministic.
function splitEvenly(totalCents, memberIds) {
  if (!Number.isInteger(totalCents) || totalCents <= 0) {
    throw new Error("totalCents must be a positive integer");
  }
  if (!Array.isArray(memberIds) || memberIds.length === 0) {
    throw new Error("memberIds must be a non-empty array");
  }
  const n = memberIds.length;
  const base = Math.floor(totalCents / n);
  const remainder = totalCents - base * n;

  const shares = new Map();
  memberIds.forEach((id, index) => {
    shares.set(id, base + (index < remainder ? 1 : 0));
  });
  return shares;
}

module.exports = { MAX_CENTS, parseDollarsToCents, centsToDollarString, splitEvenly };
