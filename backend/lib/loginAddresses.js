const crypto = require("crypto");
const pool = require("../db");

// Addresses are stored only as a keyed hash: the table can say "this
// account has signed in from here before" but not where "here" is.
function addrHash(ipBucket) {
  const key = process.env.PROXY_SECRET || "tally-dev-key";
  return crypto.createHmac("sha256", key).update(String(ipBucket)).digest();
}

async function rememberAddress(db, userId, ipBucket) {
  await db.query(
    `INSERT INTO login_addresses (user_id, addr_hash) VALUES ($1, $2)
     ON CONFLICT (user_id, addr_hash) DO UPDATE SET last_seen = now()`,
    [userId, addrHash(ipBucket)]
  );
  // Keep the list short: forget addresses not used for 90 days.
  await db.query("DELETE FROM login_addresses WHERE user_id = $1 AND last_seen < now() - interval '90 days'", [userId]);
}

async function isKnownAddress(email, ipBucket) {
  if (!email) return false;
  const r = await pool.query(
    `SELECT 1 FROM login_addresses la JOIN users u ON u.id = la.user_id
     WHERE lower(u.email) = $1 AND la.addr_hash = $2`,
    [email, addrHash(ipBucket)]
  );
  return r.rows.length > 0;
}

module.exports = { rememberAddress, isKnownAddress };
