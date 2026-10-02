require("dotenv").config();
const express = require("express");
const helmet = require("helmet");

const authRoutes = require("./routes/auth");
const groupsRoutes = require("./routes/groups");
const invitesRoutes = require("./routes/invites");
const { loadUser, requireAuth } = require("./middleware/auth");
const { csrfGuard } = require("./middleware/security");
const { proxyGuard } = require("./middleware/proxy");
const { generalLimiter, userWriteLimiter } = require("./lib/rateLimits");

// Fail closed: in production the origin check must have something to check
// against, rather than silently allowing everything.
if (process.env.NODE_ENV === "production") {
  for (const key of ["APP_ORIGIN", "PROXY_SECRET"]) {
    if (!process.env[key]) throw new Error(`${key} must be set in production.`);
  }
  if (process.env.PROXY_SECRET.length < 32) throw new Error("PROXY_SECRET must be at least 32 characters.");
}

const app = express();

// X-Forwarded-For is never trusted (a client can write anything in it). The
// visitor's address comes from the authenticated Vercel proxy instead — see
// middleware/proxy.js.
app.set("trust proxy", false);
app.disable("x-powered-by");

// This is a JSON API that browsers only reach same-origin (through the
// frontend's /api proxy), so no CORS headers are sent at all: other sites'
// scripts can't read its responses.
app.use(helmet());
app.use((req, res, next) => {
  // Nothing from this API should ever be cached by a browser or proxy —
  // responses contain private balances.
  res.setHeader("Cache-Control", "no-store");
  next();
});
app.use(proxyGuard);
app.use(generalLimiter);
app.use(express.json({ limit: "10kb" }));
app.use(csrfGuard);

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.use(loadUser);
app.use("/api/auth", authRoutes);
app.use("/api/groups", requireAuth, userWriteLimiter, groupsRoutes);
app.use("/api/invites", requireAuth, userWriteLimiter, invitesRoutes);

app.use((req, res) => res.status(404).json({ error: "Not found." }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.status && err.status < 500 && err.expose !== false) {
    // Body-parser errors (bad JSON, too large) and our own HttpErrors.
    const message = err.type === "entity.too.large" ? "Request is too large." : err.type ? "Malformed request." : err.message;
    return res.status(err.status).json({ error: message });
  }
  console.error(err);
  res.status(500).json({ error: "Something went wrong. Please try again." });
});

if (require.main === module) {
  const PORT = process.env.PORT || 4002;
  app.listen(PORT, () => console.log(`Tally API running on port ${PORT}`));
}

module.exports = app;
