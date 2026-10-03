const { parseDollarsToCents } = require("./money");

const MAX_GROUP_MEMBERS = 30;
const MAX_GROUPS_PER_USER = 50;
const MAX_PENDING_REQUESTS_PER_GROUP = 50;
const MAX_PENDING_PAYMENTS_PER_MEMBER = 20;
const MAX_EXPENSES_PER_GROUP = 5000;
const MAX_PAYMENTS_PER_GROUP = 5000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INVITE_TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;
const RESET_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Strips control characters, zero-width characters and Unicode bidi
// overrides (which can make text *display* differently from what it says —
// e.g. a description that renders as a smaller amount than it reads), then
// collapses whitespace.
function cleanText(value) {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFC")
    .replace(/\s+/g, " ") // newlines/tabs become spaces first, so words don't run together
    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g, "")
    .replace(/ {2,}/g, " ")
    .trim();
}

function isUuid(value) {
  return typeof value === "string" && UUID_RE.test(value);
}

// Reset tokens are 32 random bytes as base64url: always exactly 43 characters.
function isResetToken(value) {
  return typeof value === "string" && RESET_TOKEN_RE.test(value);
}

function isInviteToken(value) {
  return typeof value === "string" && INVITE_TOKEN_RE.test(value);
}

function parsePositiveInt(value) {
  const n = typeof value === "string" && /^\d{1,9}$/.test(value) ? Number(value) : value;
  return Number.isInteger(n) && n > 0 && n <= 2_147_483_647 ? n : null;
}

// Amounts must arrive as strings like "12.50". A JSON number such as 12.345
// would be silently rounded by float formatting; a string is checked exactly.
function parseAmount(value) {
  return typeof value === "string" ? parseDollarsToCents(value) : null;
}

// Names the UI uses for itself — "you", the "(2)" duplicate suffix, the ★
// owner mark — can't be taken as a display name, so nobody can make a line
// like "Kwesi owes you $20" appear on someone else's screen.
const RESERVED_NAMES = new Set(["you", "me", "yourself", "myself"]);

// Look-alike letters from other alphabets (Cyrillic "о", Greek "υ", …) could
// spell a reserved word that looks identical on screen. So a name may not mix
// Latin letters with Cyrillic, Greek, Armenian or Cherokee ones — the scripts
// with Latin look-alikes — and every name is NFKC-folded first, which turns
// fullwidth and other compatibility forms ("ｙｏｕ") into plain letters.
const LOOKALIKE_SCRIPTS = [/\p{Script=Cyrillic}/u, /\p{Script=Greek}/u, /\p{Script=Armenian}/u, /\p{Script=Cherokee}/u];
function mixesLookalikeScripts(name) {
  if (!/\p{Script=Latin}/u.test(name)) return false;
  return LOOKALIKE_SCRIPTS.some((re) => re.test(name));
}

function nameProblem(name) {
  if (RESERVED_NAMES.has(name.toLowerCase())) return `"${name}" can't be used as a name here.`;
  if (mixesLookalikeScripts(name)) return "Names can't mix letters from different alphabets.";
  if (/[()★☆*<>]/.test(name)) return "Names can't contain brackets, stars or angle brackets.";
  return null;
}

function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function validateSignup(body = {}) {
  const email = normalizeEmail(body.email);
  if (email.length > 254 || !EMAIL_RE.test(email)) return { error: "Enter a valid email address." };

  const displayName = cleanText(typeof body.display_name === "string" ? body.display_name.normalize("NFKC") : body.display_name);
  if (displayName.length < 1 || displayName.length > 50) {
    return { error: "Your name must be between 1 and 50 characters." };
  }
  const problem = nameProblem(displayName);
  if (problem) return { error: problem };

  const passwordProblem = passwordError(body.password, email);
  if (passwordProblem) return { error: passwordProblem };

  return { email, displayName, password: body.password };
}

// The one set of password rules, shared by signup and password reset.
// `email` must already be normalised (trimmed, lower-case).
function passwordError(password, email) {
  if (typeof password !== "string" || password.length < 10) return "Use a password of at least 10 characters.";
  if (password.length > 200) return "That password is too long (200 characters max).";
  if (password.toLowerCase() === email) return "Your password can't be your email address.";
  return null;
}

function validateLogin(body = {}) {
  const email = normalizeEmail(body.email);
  const password = body.password;
  if (!email || email.length > 254 || typeof password !== "string" || !password || password.length > 200) {
    return { error: "Email or password is incorrect." };
  }
  return { email, password };
}

const CURRENCIES = ["GHS", "USD"];
const DEFAULT_CURRENCY = "GHS";

function validateGroupName(body = {}) {
  const name = cleanText(body.name);
  if (name.length < 2 || name.length > 80) return { error: "Give the tab a name between 2 and 80 characters." };
  // Omitted = the default (Ghana cedis); anything else must be a supported code.
  const currency = body.currency === undefined ? DEFAULT_CURRENCY : body.currency;
  if (!CURRENCIES.includes(currency)) return { error: "Pick Ghana cedis (GHS) or US dollars (USD) as the tab's currency." };
  return { name, currency };
}

// `activeMemberIds` is the Set of member ids currently in the tab. The payer
// is never taken from the request — it's always the logged-in member — so
// nobody can record an expense as if someone else had paid it.
function validateExpenseInput(body = {}, activeMemberIds) {
  const description = cleanText(body.description);
  if (description.length < 1 || description.length > 200) {
    return { error: "Description must be between 1 and 200 characters." };
  }

  const amountCents = parseAmount(body.amount);
  if (amountCents === null) {
    return { error: "Enter a valid amount between 0.01 and 1,000,000, with at most 2 decimal places." };
  }

  const raw = body.participant_ids;
  if (!Array.isArray(raw) || raw.length === 0) {
    return { error: "Pick at least one person to split this between." };
  }
  if (raw.length > MAX_GROUP_MEMBERS) return { error: "Too many people selected." };
  const ids = new Set();
  for (const value of raw) {
    const id = parsePositiveInt(value);
    if (id === null || !activeMemberIds.has(id)) {
      return { error: "Everyone you split with has to be a current member of this tab." };
    }
    ids.add(id);
  }

  if (amountCents < ids.size) {
    return { error: `${ids.size} people can't split less than ${(ids.size / 100).toFixed(2)} — everyone's share must be at least 0.01.` };
  }

  return { description, amountCents, participantIds: [...ids].sort((a, b) => a - b) };
}

function validatePaymentInput(body = {}, myMemberId, activeMemberIds) {
  const direction = body.direction;
  if (direction !== "sent" && direction !== "received") {
    return { error: "Say whether you paid this person or they paid you." };
  }
  const counterpartyId = parsePositiveInt(body.counterparty_id);
  if (counterpartyId === null || !activeMemberIds.has(counterpartyId)) {
    return { error: "Pick someone who's currently in this tab." };
  }
  if (counterpartyId === myMemberId) return { error: "You can't record a payment to yourself." };

  const amountCents = parseAmount(body.amount);
  if (amountCents === null) {
    return { error: "Enter a valid amount between 0.01 and 1,000,000, with at most 2 decimal places." };
  }
  return { direction, counterpartyId, amountCents };
}

module.exports = {
  MAX_GROUP_MEMBERS,
  CURRENCIES,
  DEFAULT_CURRENCY,
  MAX_GROUPS_PER_USER,
  MAX_PENDING_REQUESTS_PER_GROUP,
  MAX_PENDING_PAYMENTS_PER_MEMBER,
  MAX_EXPENSES_PER_GROUP,
  MAX_PAYMENTS_PER_GROUP,
  cleanText,
  parseAmount,
  isUuid,
  isInviteToken,
  parsePositiveInt,
  normalizeEmail,
  passwordError,
  isResetToken,
  validateSignup,
  validateLogin,
  validateGroupName,
  validateExpenseInput,
  validatePaymentInput,
};
