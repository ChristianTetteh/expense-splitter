require("dotenv").config();
const fs = require("fs");
const path = require("path");
const pool = require("./db");

// Versioned migrations: each file in migrations/ runs exactly once, in name
// order, inside its own transaction, and is recorded in schema_migrations.
// A Postgres advisory lock stops two instances that boot at the same time
// (e.g. during a zero-downtime deploy) from running the same migration twice.
const MIGRATION_LOCK_ID = 7_041_993;

async function migrate({ closePool = true } = {}) {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         name TEXT PRIMARY KEY,
         applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
       )`
    );
    const applied = new Set((await client.query("SELECT name FROM schema_migrations")).rows.map((r) => r.name));

    const dir = path.join(__dirname, "migrations");
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = fs.readFileSync(path.join(dir, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
        console.log(`✓ Applied migration ${file}`);
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${file} failed: ${err.message}`);
      }
    }

    // Housekeeping: expired sessions are useless; clear them on every boot.
    await client.query("DELETE FROM sessions WHERE expires_at < now()");
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]).catch(() => {});
    client.release();
    if (closePool) await pool.end();
  }
}

if (require.main === module) {
  migrate().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = migrate;
