const express = require("express");
const pool = require("../db");
const { validateSignup, validateLogin } = require("../lib/validation");
const { hashPassword, verifyPassword, dummyHash } = require("../lib/passwords");
const { createSession, setSessionCookie, clearSessionCookie } = require("../lib/sessions");
const { asyncHandler, HttpError } = require("../lib/http");
const { requireAuth } = require("../middleware/auth");
const { authIpLimiter, loginPairLimiter, loginAccountLimiter } = require("../lib/rateLimits");
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
