const rateLimit = require("express-rate-limit");
const { normalizeEmail } = require("./validation");
const { isKnownAddress } = require("./loginAddresses");
const { GENERIC_FORGOT_MESSAGE } = require("./passwordReset");

const FIFTEEN_MIN = 15 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

// Limits are off under Jest (where hundreds of requests come from one
// address in milliseconds) unless a test opts in to exercise them.
const enabled = () => process.env.NODE_ENV !== "test" || process.env.TEST_RATE_LIMITS === "1";

// req.ipBucket is set by middleware/proxy.js from an address the client
// can't forge (see there). Express's own req.ip is never used.
const byIp = (req) => req.ipBucket || "unknown";

const limiter = (opts) =>
  rateLimit({
    standardHeaders: true,
    legacyHeaders: false,
    validate: false,
    keyGenerator: byIp,
    skip: () => !enabled(),
    ...opts,
    message: { error: opts.message },
  });

const emailOf = (req) => normalizeEmail(req.body && req.body.email).slice(0, 254);

const authIpLimiter = limiter({
  windowMs: FIFTEEN_MIN,
  max: 30,
  message: "Too many attempts from this network. Try again in a few minutes.",
});

// Password guessing against one account from one place: 8 failures per 15
// minutes per (account, address). Keyed on BOTH so that someone else
// hammering your email can't lock you out from your own connection.
const loginPairLimiter = limiter({
  windowMs: FIFTEEN_MIN,
  max: 8,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `login:${emailOf(req)}:${byIp(req)}`,
  message: "Too many failed attempts. Try again in 15 minutes.",
});

// Distributed guessing (many addresses, one account) hits this ceiling of
// ~100 guesses an hour. It does NOT apply to addresses the account has
// successfully signed in from before — so even a sustained attack on your
// email from many places can't lock you out from your usual connection.
const loginAccountLimiter = limiter({
  windowMs: HOUR,
  max: 100,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `login-account:${emailOf(req)}`,
  skip: async (req) => !enabled() || (await isKnownAddress(emailOf(req), byIp(req)).catch(() => false)),
  message: "This account has had too many failed sign-in attempts from new places. Try again in an hour, or from a network you've used before.",
});

// "Forgot password" must answer exactly the same whether or not the email has
// an account AND whether or not a limit was hit, so neither limiter ever
// shows a 429 or RateLimit-* headers. Past the per-address limit the request
// is simply answered with the usual message and ignored.
const forgotIpLimiter = limiter({
  windowMs: FIFTEEN_MIN,
  max: 5,
  standardHeaders: false,
  handler: (req, res) => res.status(200).json({ message: GENERIC_FORGOT_MESSAGE }),
});

// 3 emails an hour to one address, so nobody can use Tally to flood an
// inbox. Past that the request still gets the usual answer, but flags the
// request so the route sends nothing.
const forgotEmailLimiter = limiter({
  windowMs: HOUR,
  max: 3,
  standardHeaders: false,
  keyGenerator: (req) => `forgot-email:${emailOf(req)}`,
  handler: (req, res, next) => {
    req.mailSilenced = true;
    next();
  },
});

// Submitting new passwords with (guessed) reset tokens: 10 per 15 minutes per address.
const resetIpLimiter = limiter({
  windowMs: FIFTEEN_MIN,
  max: 10,
  message: "Too many attempts. Try again in a few minutes.",
});

// Every logged-in write (expenses, payments, joins…), per account.
const userWriteLimiter = limiter({
  windowMs: FIFTEEN_MIN,
  max: 150,
  keyGenerator: (req) => `user:${req.user ? req.user.id : byIp(req)}`,
  skip: (req) => !enabled() || req.method === "GET",
  message: "You're doing that a lot. Give it a few minutes.",
});

// Broad backstop on all traffic per address.
const generalLimiter = limiter({
  windowMs: FIFTEEN_MIN,
  max: 1500,
  message: "Too many requests. Try again in a few minutes.",
});

module.exports = {
  authIpLimiter,
  loginPairLimiter,
  loginAccountLimiter,
  forgotIpLimiter,
  forgotEmailLimiter,
  resetIpLimiter,
  userWriteLimiter,
  generalLimiter,
};
