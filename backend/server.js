require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const groupsRoutes = require("./routes/groups");
const expensesRoutes = require("./routes/expenses");

const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
app.use(express.json());

// Creating groups and expenses are the two unauthenticated write paths, so
// they get their own tighter limit to blunt scripted abuse.
const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use((req, res, next) => {
  if (req.method === "POST" || req.method === "DELETE") return writeLimiter(req, res, next);
  next();
});

app.get("/api/health", (req, res) => res.json({ ok: true }));
app.use("/api/groups", groupsRoutes);
app.use("/api/expenses", expensesRoutes);

app.use((req, res) => res.status(404).json({ error: "Not found." }));

if (process.env.NODE_ENV !== "test") {
  const PORT = process.env.PORT || 4002;
  app.listen(PORT, () => console.log(`Expense Splitter API running on port ${PORT}`));
}

module.exports = app;
