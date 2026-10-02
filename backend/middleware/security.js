// Cross-site request forgery defences for every state-changing request.
// The session cookie is already SameSite=Lax (browsers won't attach it to a
// cross-site POST); these checks are a second, independent layer.

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function allowedOrigin() {
  return process.env.APP_ORIGIN || null;
}

function csrfGuard(req, res, next) {
  if (!UNSAFE.has(req.method)) return next();

  // 1. Only JSON bodies. An HTML <form> on another site can't send
  //    application/json without triggering a CORS preflight, which this API
  //    never approves.
  if (!req.is("application/json")) {
    return res.status(415).json({ error: "Requests must be sent as JSON." });
  }

  // 2. Modern browsers label every request with where it came from.
  const fetchSite = req.headers["sec-fetch-site"];
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    return res.status(403).json({ error: "Cross-site requests aren't allowed." });
  }

  // 3. If the browser sent an Origin, it must be this app's own.
  const origin = req.headers.origin;
  const allowed = allowedOrigin();
  if (origin && allowed && origin !== allowed) {
    return res.status(403).json({ error: "Cross-site requests aren't allowed." });
  }

  next();
}

module.exports = { csrfGuard };
