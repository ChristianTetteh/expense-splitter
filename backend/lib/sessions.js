const crypto = require("crypto");

const SESSION_DAYS = 14;
const MAX_SESSIONS_PER_USER = 10;

const isProduction = () => process.env.NODE_ENV === "production";

// The __Host- prefix makes the browser refuse the cookie unless it's Secure,
// has Path=/ and no Domain — so it can't be set or overwritten by any other
// subdomain. Browsers only honour it over HTTPS, so local dev uses a plain name.
const cookieName = () => (isProduction() ? "__Host-tally_session" : "tally_session");

function newToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest();
}

function parseCookies(header) {
  const out = {};
  if (typeof header !== "string") return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key && !(key in out)) out[key] = value;
  }
  return out;
}

function readSessionToken(req) {
  const token = parseCookies(req.headers.cookie)[cookieName()];
  // Tokens we issue are exactly 43 base64url chars; anything else is junk.
  return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

function cookieAttributes(maxAgeSeconds) {
  const attrs = ["Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAgeSeconds}`];
  if (isProduction()) attrs.push("Secure");
  return attrs.join("; ");
}

function setSessionCookie(res, token) {
  res.setHeader("Set-Cookie", `${cookieName()}=${token}; ${cookieAttributes(SESSION_DAYS * 24 * 60 * 60)}`);
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", `${cookieName()}=; ${cookieAttributes(0)}`);
}

// Creates a session row and returns the raw token (which only ever lives in
// the user's cookie). Also trims the user's oldest sessions beyond the cap.
async function createSession(client, userId) {
  const token = newToken();
  await client.query(
    `INSERT INTO sessions (token_hash, user_id, expires_at)
     VALUES ($1, $2, now() + make_interval(days => $3))`,
    [hashToken(token), userId, SESSION_DAYS]
  );
  await client.query(
    `DELETE FROM sessions WHERE user_id = $1 AND (
       expires_at < now() OR token_hash NOT IN (
         SELECT token_hash FROM sessions WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2
       ))`,
    [userId, MAX_SESSIONS_PER_USER]
  );
  return token;
}

module.exports = {
  SESSION_DAYS,
  cookieName,
  hashToken,
  parseCookies,
  readSessionToken,
  setSessionCookie,
  clearSessionCookie,
  createSession,
};
