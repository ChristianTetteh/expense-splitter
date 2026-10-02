// Runs with the production proxy setup switched on: a shared secret that only
// the Vercel proxy knows, which also carries the visitor's real address.
process.env.TEST_RATE_LIMITS = "1";
process.env.PROXY_SECRET = "test-proxy-secret-that-is-long-enough-123";
const { app, pool, request, PASSWORD, resetDb } = require("./helpers");

const SECRET = process.env.PROXY_SECRET;
const viaProxy = (ip) => ({ "x-tally-proxy-secret": SECRET, "x-tally-client-ip": ip });

beforeAll(resetDb);
afterAll(() => pool.end());

async function signupVia(ip, name) {
  const email = `${name}@test.dev`;
  const res = await request(app).post("/api/auth/signup").set(viaProxy(ip)).send({ email, display_name: name, password: PASSWORD });
  expect(res.status).toBe(201);
  return email;
}

const login = (ip, email, password, extra = {}) =>
  request(app).post("/api/auth/login").set({ ...viaProxy(ip), ...extra }).send({ email, password });

describe("the proxy secret", () => {
  it("refuses requests that skip the proxy (no secret or a wrong one)", async () => {
    expect((await request(app).post("/api/auth/login").send({ email: "a@b.co", password: "x" })).status).toBe(403);
    expect((await request(app).get("/api/auth/me").set("x-tally-proxy-secret", "guess")).status).toBe(403);
    expect((await request(app).get("/api/health")).status).toBe(200); // health check stays open for the platform
  });
});

describe("password guessing", () => {
  it("blocks repeated guesses from one address — and X-Forwarded-For can't be used to dodge it", async () => {
    const email = await signupVia("198.51.100.1", "victim");
    for (let i = 0; i < 8; i++) {
      // The attacker rotates X-Forwarded-For; it's ignored.
      const res = await login("203.0.113.9", email, `guess-${i}-xxxxxxxx`, { "X-Forwarded-For": `10.0.0.${i}` });
      expect(res.status).toBe(401);
    }
    expect((await login("203.0.113.9", email, "guess-9-xxxxxxxx", { "X-Forwarded-For": "10.9.9.9" })).status).toBe(429);
  });

  it("an attacker locking themselves out doesn't lock out the real owner on their own connection", async () => {
    const email = await signupVia("198.51.100.2", "owner");
    for (let i = 0; i < 9; i++) await login("203.0.113.50", email, `nope-${i}-xxxxxxxx`);
    expect((await login("203.0.113.50", email, PASSWORD)).status).toBe(429);
    expect((await login("198.51.100.2", email, PASSWORD)).status).toBe(200);
  });

  it("REGRESSION: a many-address attack on your email can't lock you out from a network you've used before", async () => {
    const email = await signupVia("198.51.100.4", "target"); // signing up remembers this address
    for (let i = 0; i < 104; i++) await login(`192.0.2.${100 + (i % 13)}`, email, `spray-${i}-xxxxxxxx`);
    expect((await login("192.0.2.200", email, PASSWORD)).status).toBe(429); // a new place is blocked…
    expect((await login("198.51.100.4", email, PASSWORD)).status).toBe(200); // …your own isn't
  }, 60_000);

  it("caps total guesses at one account even when spread across many addresses", async () => {
    const email = await signupVia("198.51.100.3", "distributed");
    let blocked = false;
    for (let i = 0; i < 101 && !blocked; i++) {
      const res = await login(`192.0.2.${i}`, email, `spray-${i}-xxxxxxxx`);
      blocked = res.status === 429;
    }
    expect(blocked).toBe(true);
  }, 60_000);
});
