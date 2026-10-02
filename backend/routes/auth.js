const express = require("express");
const pool = require("../db");
const { validateSignup, validateLogin, normalizeEmail, passwordError, isResetToken } = require("../lib/validation");
const mailer = require("../lib/mailer");
const { GENERIC_FORGOT_MESSAGE, INVALID_LINK_MESSAGE, RESET_MINUTES, newResetToken, hashResetToken, resetLink, resetEmail } = require("../lib/passwordReset");
const { hashPassword, verifyPassword, dummyHash } = require("../lib/passwords");
const { createSession, setSessionCookie, clearSessionCookie } = require("../lib/sessions");
const { asyncHandler, HttpError } = require("../lib/http");
const { requireAuth } = require("../middleware/auth");
const { authIpLimiter, loginPairLimiter, loginAccountLimiter, forgotIpLimiter, forgotEmailLimiter, resetIpLimiter } = require("../lib/rateLimits");
const { rememberAddress } = require("../lib/loginAddresses");

const router = express.Router();

const publicUser = (u) => ({ id: u.id, email: u.email, display_name: u.display_name });

router.post(
  "/signup",
  authIpLimiter,
  asyncHandler(async (req, res) => {
    const input = validateSignup(req.body);
    if (input.error) throw new HttpError(400, input.error);

    const passwordHash = await hashPassword(input.password);
    let user;
    let token;
    try {
      ({ user, token } = await pool.withTransaction(async (client) => {
        const result = await client.query(
          "INSERT INTO users (email, display_name, password_hash) VALUES ($1, $2, $3) RETURNING id, email, display_name",
          [input.email, input.displayName, passwordHash]
        );
        const created = result.rows[0];
        await rememberAddress(client, created.id, req.ipBucket);
        return { user: created, token: await createSession(client, created.id) };
      }));
    } catch (err) {
      if (err.code === "23505") throw new HttpError(409, "An account with that email already exists. Try logging in.");
      throw err;
    }

    setSessionCookie(res, token);
    res.status(201).json({ user: publicUser(user) });
  })
);

router.post(
  "/login",
  authIpLimiter,
  loginPairLimiter,
  loginAccountLimiter,
  asyncHandler(async (req, res) => {
    const input = validateLogin(req.body);
    if (input.error) throw new HttpError(401, input.error);

    const result = await pool.query(
      "SELECT id, email, display_name, password_hash FROM users WHERE lower(email) = $1",
      [input.email]
    );
    const user = result.rows[0];
    // Same work and same answer whether or not the email exists.
    const ok = await verifyPassword(input.password, user ? user.password_hash : await dummyHash());
    if (!user || !ok) throw new HttpError(401, "Email or password is incorrect.");

    // A brand-new token every login (never reuse one), so a token planted
    // before login can't become a logged-in session.
    const token = await pool.withTransaction(async (client) => {
      await rememberAddress(client, user.id, req.ipBucket);
      return createSession(client, user.id);
    });
    setSessionCookie(res, token);
    res.json({ user: publicUser(user) });
  })
);

// ── Password reset ──────────────────────────────────────────────────────

// Background work started after a response has gone out. Tracked so tests
// (and a graceful shutdown) can wait for it.
const pending = new Set();
function inBackground(promise) {
  const p = promise.catch((err) => console.error("[password reset] background step failed:", err && err.message));
  pending.add(p);
  p.finally(() => pending.delete(p));
}
const settleBackgroundWork = () => Promise.allSettled([...pending]);

// Looks the account up, replaces any earlier unused links with a new one and
// emails it. Runs AFTER the response, so a real account and an unknown email
// take exactly the same time to answer.
async function sendResetEmail(email) {
  const found = await pool.query("SELECT id, email, display_name FROM users WHERE lower(email) = $1", [email]);
  const user = found.rows[0];
  if (!user) return;

  if (!resetLink("probe")) {
    console.error("[password reset] APP_ORIGIN is not a valid http(s) URL; no email sent.");
    return;
  }

  const token = newResetToken();
  await pool.withTransaction(async (client) => {
    await client.query("UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL", [user.id]);
    await client.query(
      "INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES ($1, $2, now() + make_interval(mins => $3))",
      [user.id, hashResetToken(token), RESET_MINUTES]
    );
  });
  await mailer.sendMail({ to: user.email, ...resetEmail({ displayName: user.display_name, link: resetLink(token) }) });
}

router.post(
  "/forgot",
  (req, res, next) => {
    // The only non-200 answer: input that isn't a string at all.
    if (!req.body || typeof req.body.email !== "string") return res.status(400).json({ error: "Enter your email address." });
    next();
  },
  forgotIpLimiter,
  forgotEmailLimiter,
  (req, res) => {
    const email = normalizeEmail(req.body.email);
    const silenced = req.mailSilenced === true;
    res.status(200).json({ message: GENERIC_FORGOT_MESSAGE });
    if (!silenced && email && email.length <= 254) inBackground(sendResetEmail(email));
  }
);

router.post(
  "/reset",
  resetIpLimiter,
  asyncHandler(async (req, res) => {
    const { token, password } = req.body || {};
    const invalid = () => res.status(400).json({ error: INVALID_LINK_MESSAGE, code: "invalid_token" });
    if (!isResetToken(token)) return invalid();
    if (typeof password !== "string") throw new HttpError(400, "Use a password of at least 10 characters.");

    const outcome = await pool.withTransaction(async (client) => {
      // Lock the reset row first: of two simultaneous submits, the second
      // waits here, then finds the row already used and matches nothing.
      const found = await client.query(
        `SELECT pr.id, pr.user_id, u.email
         FROM password_resets pr JOIN users u ON u.id = pr.user_id
         WHERE pr.token_hash = $1 AND pr.used_at IS NULL AND pr.expires_at > now()
         FOR UPDATE OF pr`,
        [hashResetToken(token)]
      );
      const row = found.rows[0];
      if (!row) return { invalid: true };

      // Same rules as signup; a rejected password rolls back and leaves the link usable.
      const problem = passwordError(password, normalizeEmail(row.email));
      if (problem) throw new HttpError(400, problem);

      const passwordHash = await hashPassword(password);
      await client.query("UPDATE users SET password_hash = $1 WHERE id = $2", [passwordHash, row.user_id]);
      await client.query("UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL", [row.user_id]);
      // Log out everywhere: whoever knew the old password loses their session too.
      await client.query("DELETE FROM sessions WHERE user_id = $1", [row.user_id]);
      return { ok: true };
    });

    if (outcome.invalid) return invalid();
    // Deliberately not logged in: they log in again with the new password.
    clearSessionCookie(res);
    res.json({ ok: true });
  })
);

router.post(
  "/logout",
  asyncHandler(async (req, res) => {
    if (req.sessionTokenHash) {
      await pool.query("DELETE FROM sessions WHERE token_hash = $1", [req.sessionTokenHash]);
    }
    clearSessionCookie(res);
    res.json({ ok: true });
  })
);

router.get("/me", requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

module.exports = router;
module.exports.settleBackgroundWork = settleBackgroundWork;
