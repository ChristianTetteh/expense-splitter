const pool = require("../db");
const { readSessionToken, hashToken } = require("../lib/sessions");

// Attaches req.user (or leaves it undefined) from the session cookie. Never
// rejects on its own — routes that need a user use requireAuth below.
async function loadUser(req, res, next) {
  const token = readSessionToken(req);
  if (!token) return next();
  try {
    const result = await pool.query(
      `SELECT u.id, u.email, u.display_name
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > now()`,
      [hashToken(token)]
    );
    if (result.rows[0]) {
      req.user = result.rows[0];
      req.sessionTokenHash = hashToken(token);
    }
    next();
  } catch (err) {
    next(err);
  }
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Please log in." });
  next();
}

module.exports = { loadUser, requireAuth };
