// Vercel Routing Middleware: the only way into the API.
//
// Every /api request is forwarded to the backend with two headers the
// browser can't forge, because they're set here on Vercel's side and
// overwrite anything the client sent:
//   x-tally-proxy-secret — proves the request came through this proxy (the
//                          backend refuses everything without it)
//   x-tally-client-ip    — the visitor's real address, taken from Vercel's
//                          own connection info, used for rate limiting
import { ipAddress, rewrite } from "@vercel/functions";

export const config = { matcher: "/api/:path*" };

export default function middleware(request) {
  const backend = process.env.BACKEND_ORIGIN;
  const secret = process.env.PROXY_SECRET;
  if (!backend || !secret) {
    return new Response(JSON.stringify({ error: "Service misconfigured." }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
  }

  const url = new URL(request.url);
  const destination = new URL(url.pathname + url.search, backend);

  const headers = new Headers(request.headers);
  headers.set("x-tally-proxy-secret", secret);
  const ip = ipAddress(request);
  if (ip) headers.set("x-tally-client-ip", ip);
  else headers.delete("x-tally-client-ip");

  return rewrite(destination, { request: { headers } });
}
