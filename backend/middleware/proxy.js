const crypto = require("crypto");
const net = require("net");

// In production the API is only meant to be reached through the frontend's
// Vercel proxy, which stamps every request with a shared secret and the
// visitor's real IP (Vercel sets that from the actual connection and
// overwrites anything the client sends). Requests that skip the proxy —
// straight to the onrender.com URL — have no secret and are refused, so a
// client can never feed the API a made-up IP address.

const SECRET_HEADER = "x-tally-proxy-secret";
const IP_HEADER = "x-tally-client-ip";

function secretMatches(given, expected) {
  if (typeof given !== "string") return false;
  const a = crypto.createHash("sha256").update(given).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

// Rate-limit bucket for an address. IPv6 users typically control a whole /64,
// so they're bucketed by that prefix rather than by single address.
function ipBucket(ip) {
  if (net.isIPv4(ip)) return ip;
  if (net.isIPv6(ip)) {
    const v4 = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    if (v4) return v4[1];
    const full = expandIPv6(ip);
    return full ? `${full.slice(0, 4).join(":")}::/64` : ip;
  }
  return "unknown";
}

function expandIPv6(ip) {
  const [head, tail = ""] = ip.split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  if (ip.includes("::")) {
    const fill = 8 - h.length - t.length;
    if (fill < 0) return null;
    return [...h, ...Array(fill).fill("0"), ...t];
  }
  return h.length === 8 ? h : null;
}

function proxyGuard(req, res, next) {
  const secret = process.env.PROXY_SECRET;
  if (secret) {
    if (req.path !== "/api/health" && !secretMatches(req.headers[SECRET_HEADER], secret)) {
      return res.status(403).json({ error: "Forbidden." });
    }
    const claimed = req.headers[IP_HEADER];
    req.clientIp = typeof claimed === "string" && net.isIP(claimed) ? claimed : req.socket.remoteAddress || "unknown";
  } else {
    // Local development and tests: no proxy in front, use the socket address.
    req.clientIp = req.socket.remoteAddress || "unknown";
  }
  req.ipBucket = ipBucket(req.clientIp);
  next();
}

module.exports = { proxyGuard, ipBucket, SECRET_HEADER, IP_HEADER };
