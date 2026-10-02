// Runs before any test module loads, so db.js connects to the test database.
process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || "postgresql:///tally_test";
process.env.PGSSL = "false";
process.env.APP_ORIGIN = "http://localhost:5173";
