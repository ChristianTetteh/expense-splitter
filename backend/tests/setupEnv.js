// Runs before any test module loads, so db.js connects to the test database.
process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || "postgresql://postgres:localpass@127.0.0.1:5432/tally_test";
process.env.PGSSL = "false";
process.env.APP_ORIGIN = "http://localhost:5173";
