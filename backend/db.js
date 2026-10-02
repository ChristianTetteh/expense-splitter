const { Pool } = require("pg");

const useSSL = process.env.PGSSL !== "false";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSSL ? { rejectUnauthorized: false } : false,
  max: 10,
  // A stuck query shouldn't hold a connection (or a row lock) forever.
  statement_timeout: 10_000,
  idle_in_transaction_session_timeout: 15_000,
});

// Runs fn(client) inside BEGIN/COMMIT, rolling back on any error.
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

pool.withTransaction = withTransaction;
module.exports = pool;
