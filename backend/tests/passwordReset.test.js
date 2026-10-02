// Same production-like setup as rateLimits.test.js: requests arrive through the
// proxy (shared secret + client address) and the limiters are switched on.
process.env.TEST_RATE_LIMITS = "1";
process.env.PROXY_SECRET = "test-proxy-secret-that-is-long-enough-123";

jest.mock("../lib/mailer", () => ({ sendMail: jest.fn(async () => ({ sent: true })), isConfigured: jest.fn(() => true) }));

const crypto = require("crypto");
const { app, pool, request, PASSWORD, resetDb } = require("./helpers");
const mailer = require("../lib/mailer");
const { settleBackgroundWork } = require("../routes/auth");
const { GENERIC_FORGOT_MESSAGE, INVALID_LINK_MESSAGE } = require("../lib/passwordReset");

const SECRET = process.env.PROXY_SECRET;
const NEW_PASSWORD = "a brand new passphrase";

// Every call gets its own client address so the per-address limits don't
// interact between tests; the ones that test limits reuse an address on purpose.
let ipCounter = 0;
const freshIp = () => `10.20.${Math.floor(++ipCounter / 250)}.${(ipCounter % 250) + 1}`;
const viaProxy = (ip = freshIp()) => ({ "x-tally-proxy-secret": SECRET, "x-tally-client-ip": ip });

let userCounter = 0;
async function makeUser(name = "Ama") {
  const email = `resetuser${++userCounter}@test.dev`;
  const res = await request(app).post("/api/auth/signup").set(viaProxy()).send({ email, display_name: name, password: PASSWORD });
  expect(res.status).toBe(201);
  return { email, id: res.body.user.id };
}

const login = (email, password, agent = request.agent(app)) =>
  agent.post("/api/auth/login").set(viaProxy()).send({ email, password }).then((res) => ({ res, agent }));

async function forgot(email, { ip, headers = {} } = {}) {
  const res = await request(app).post("/api/auth/forgot").set({ ...viaProxy(ip), ...headers }).send({ email });
  await settleBackgroundWork();
  return res;
}

const reset = (token, password, ip) => request(app).post("/api/auth/reset").set(viaProxy(ip)).send({ token, password });

const sentMails = () => mailer.sendMail.mock.calls.map((c) => c[0]);
const tokenFrom = (mail) => new URL(mail.text.match(/https?:\/\/\S+/)[0]).hash.slice(1);
const lastMailTo = (email) => sentMails().reverse().find((m) => m.to === email);
async function requestToken(email) {
  const res = await forgot(email);
  expect(res.status).toBe(200);
  return tokenFrom(lastMailTo(email));
}

// The only RateLimit-* headers allowed are the app-wide backstop's (1500 per
// address): nothing that reveals the forgot-password limits or a 429.
function expectNoForgotLimitSignal(res) {
  expect(res.headers["retry-after"]).toBeUndefined();
  expect(res.headers["ratelimit-limit"] === undefined || res.headers["ratelimit-limit"] === "1500").toBe(true);
}

beforeAll(resetDb);
beforeEach(() => mailer.sendMail.mockClear());
afterAll(() => pool.end());

describe("POST /api/auth/forgot", () => {
  it("answers identically for a known email, an unknown email and a malformed string (no user enumeration)", async () => {
    const { email } = await makeUser();
    const known = await forgot(email);
    const unknown = await forgot("nobody-here@test.dev");
    const malformed = await forgot("not an email at all");
    const huge = await forgot("x".repeat(5000) + "@test.dev");
    for (const res of [known, unknown, malformed, huge]) {
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ message: GENERIC_FORGOT_MESSAGE });
    }
    expect(GENERIC_FORGOT_MESSAGE).toBe("If that email has an account, a reset link is on its way. It works for 30 minutes.");
    // Headers match too (apart from per-response ones like Date / Content-Length is equal as body is equal).
    const pick = (res) => ({ ...res.headers, date: undefined, etag: undefined });
    expect(pick(known)).toEqual(pick(unknown));
    expect(known.headers["set-cookie"]).toBeUndefined();
    expect(known.headers["cache-control"]).toBe("no-store");
  });

  it("only rejects input that isn't a string", async () => {
    for (const body of [{}, { email: 5 }, { email: null }, { email: ["a@b.co"] }, { email: { $ne: "" } }]) {
      const res = await request(app).post("/api/auth/forgot").set(viaProxy()).send(body);
      expect(res.status).toBe(400);
    }
  });

  it("sends an email only for a real account, to that address", async () => {
    const { email } = await makeUser();
    await forgot("ghost@test.dev");
    expect(mailer.sendMail).not.toHaveBeenCalled();
    await forgot(`  ${email.toUpperCase()}  `); // case and spaces don't matter
    expect(mailer.sendMail).toHaveBeenCalledTimes(1);
    const mail = mailer.sendMail.mock.calls[0][0];
    expect(mail.to).toBe(email);
    expect(mail.text).toMatch(/If you didn't ask for this, ignore this email; your password hasn't changed\./);
    expect(mail.text).toMatch(/30 minutes/);
    expect(mail.html).toContain("Choose a new password");
    expect(mail.html).toContain(tokenFrom(mail));
  });

  it("builds the link from APP_ORIGIN, never from Host / X-Forwarded-Host, and keeps the token in the fragment", async () => {
    const { email } = await makeUser();
    await forgot(email, {
      headers: { Host: "evil.example", "X-Forwarded-Host": "evil.example", "X-Forwarded-Proto": "https", Origin: process.env.APP_ORIGIN, Forwarded: "host=evil.example" },
    });
    const mail = mailer.sendMail.mock.calls[0][0];
    const link = new URL(mail.text.match(/https?:\/\/\S+/)[0]);
    expect(link.origin).toBe(process.env.APP_ORIGIN);
    expect(link.pathname).toBe("/reset");
    expect(link.search).toBe("");
    expect(link.hash).toMatch(/^#[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(mail)).not.toMatch(/evil\.example/);
  });

  it("stores only the SHA-256 of the token, which expires in 30 minutes", async () => {
    const { email, id } = await makeUser();
    const token = await requestToken(email);
    const rows = (await pool.query("SELECT *, expires_at - created_at AS lifetime FROM password_resets WHERE user_id = $1", [id])).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash.equals(crypto.createHash("sha256").update(token).digest())).toBe(true);
    expect(rows[0].used_at).toBeNull();
    expect(rows[0].lifetime.minutes).toBe(30);
    // The raw token is nowhere in the table, in any encoding we'd plausibly store it.
    const dump = JSON.stringify((await pool.query("SELECT * FROM password_resets")).rows);
    expect(dump).not.toContain(token);
    expect(dump).not.toContain(Buffer.from(token).toString("hex"));
    expect(dump).not.toContain(Buffer.from(token, "base64url").toString("base64"));
  });

  it("a second request invalidates the first link", async () => {
    const { email } = await makeUser();
    const first = await requestToken(email);
    const second = await requestToken(email);
    expect(second).not.toBe(first);
    expect((await reset(first, NEW_PASSWORD)).status).toBe(400);
    expect((await reset(second, NEW_PASSWORD)).status).toBe(200);
  });

  it("is rate limited to 5 per address per 15 minutes, silently: same answer, nothing sent", async () => {
    const { email } = await makeUser();
    const ip = "198.51.100.77";
    for (let i = 0; i < 5; i++) await forgot(`someone${i}@test.dev`, { ip });
    mailer.sendMail.mockClear();
    const limited = await forgot(email, { ip }); // a REAL account, over the limit
    expect(limited.status).toBe(200);
    expect(limited.body).toEqual({ message: GENERIC_FORGOT_MESSAGE });
    expectNoForgotLimitSignal(limited);
    expect(mailer.sendMail).not.toHaveBeenCalled();
    expect((await pool.query("SELECT 1 FROM password_resets pr JOIN users u ON u.id = pr.user_id WHERE u.email = $1", [email])).rows).toHaveLength(0);
  });

  it("is rate limited to 3 per email per hour, silently, even from different addresses", async () => {
    const { email } = await makeUser();
    const answers = [];
    for (let i = 0; i < 5; i++) answers.push(await forgot(email)); // five different addresses
    expect(mailer.sendMail).toHaveBeenCalledTimes(3);
    for (const res of answers) {
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ message: GENERIC_FORGOT_MESSAGE });
      expectNoForgotLimitSignal(res);
    }
    // Unknown emails are counted the same way, so the limit itself reveals nothing.
    for (let i = 0; i < 5; i++) expect((await forgot("ghost-limited@test.dev")).body).toEqual({ message: GENERIC_FORGOT_MESSAGE });
  });

  it("goes through the same CSRF guard as every other write", async () => {
    const h = viaProxy();
    expect((await request(app).post("/api/auth/forgot").set(h).type("form").send("email=a@b.co")).status).toBe(415);
    expect((await request(app).post("/api/auth/forgot").set({ ...h, "sec-fetch-site": "cross-site" }).send({ email: "a@b.co" })).status).toBe(403);
    expect((await request(app).post("/api/auth/forgot").set({ ...h, Origin: "https://evil.example" }).send({ email: "a@b.co" })).status).toBe(403);
    expect((await request(app).post("/api/auth/reset").set({ ...h, "sec-fetch-site": "cross-site" }).send({ token: "x", password: "y" })).status).toBe(403);
    expect((await request(app).post("/api/auth/reset").set({ ...h, Origin: "https://evil.example" }).send({ token: "x", password: "y" })).status).toBe(403);
    const big = await request(app).post("/api/auth/forgot").set(h).send({ email: "a".repeat(20_000) });
    expect(big.status).toBe(413);
    expect(mailer.sendMail).not.toHaveBeenCalled();
  });
});

describe("POST /api/auth/reset", () => {
  it("changes the password: the old one stops working and the new one works", async () => {
    const { email } = await makeUser();
    const token = await requestToken(email);
    const res = await reset(token, NEW_PASSWORD);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect((await login(email, PASSWORD)).res.status).toBe(401);
    expect((await login(email, NEW_PASSWORD)).res.status).toBe(200);
    const hash = (await pool.query("SELECT password_hash FROM users WHERE email = $1", [email])).rows[0].password_hash;
    expect(hash).toMatch(/^scrypt\$32768\$8\$1\$/);
    expect(hash).not.toContain(NEW_PASSWORD);
  });

  it("does not log anyone in", async () => {
    const { email } = await makeUser();
    const token = await requestToken(email);
    const agent = request.agent(app);
    const res = await agent.post("/api/auth/reset").set(viaProxy()).send({ token, password: NEW_PASSWORD });
    const cookies = res.headers["set-cookie"] || [];
    expect(cookies.every((c) => /Max-Age=0/.test(c))).toBe(true);
    expect((await agent.get("/api/auth/me").set(viaProxy())).status).toBe(401);
  });

  it("logs out everywhere: every existing session of that user is revoked, other users' are not", async () => {
    const { email, id } = await makeUser();
    const other = await makeUser("Kwesi");
    const phone = (await login(email, PASSWORD)).agent;
    const laptop = (await login(email, PASSWORD)).agent;
    const kwesi = (await login(other.email, PASSWORD)).agent;
    expect((await phone.get("/api/auth/me").set(viaProxy())).status).toBe(200);

    const token = await requestToken(email);
    expect((await reset(token, NEW_PASSWORD)).status).toBe(200);

    expect((await phone.get("/api/auth/me").set(viaProxy())).status).toBe(401);
    expect((await laptop.get("/api/auth/me").set(viaProxy())).status).toBe(401);
    expect((await pool.query("SELECT 1 FROM sessions WHERE user_id = $1", [id])).rows).toHaveLength(0);
    expect((await kwesi.get("/api/auth/me").set(viaProxy())).status).toBe(200);
  });

  it("is single use", async () => {
    const { email } = await makeUser();
    const token = await requestToken(email);
    expect((await reset(token, NEW_PASSWORD)).status).toBe(200);
    const again = await reset(token, "another passphrase!");
    expect(again.status).toBe(400);
    expect(again.body.error).toBe(INVALID_LINK_MESSAGE);
    expect((await login(email, NEW_PASSWORD)).res.status).toBe(200); // password unchanged by the replay
    expect((await login(email, "another passphrase!")).res.status).toBe(401);
  });

  it("refuses an expired link, with the same generic error", async () => {
    const { email, id } = await makeUser();
    const token = await requestToken(email);
    await pool.query("UPDATE password_resets SET expires_at = now() - interval '1 second' WHERE user_id = $1", [id]);
    const res = await reset(token, NEW_PASSWORD);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("This reset link is invalid or has expired.");
    expect((await login(email, PASSWORD)).res.status).toBe(200);
  });

  it("answers an unknown, used and expired token with exactly the same response", async () => {
    const { email, id } = await makeUser();
    const used = await requestToken(email);
    await reset(used, NEW_PASSWORD);
    const expired = await requestToken(email);
    await pool.query("UPDATE password_resets SET expires_at = now() - interval '1 hour' WHERE user_id = $1", [id]);
    const unknown = crypto.randomBytes(32).toString("base64url");
    const bodies = [];
    for (const t of [used, expired, unknown]) {
      const res = await reset(t, "whatever passphrase");
      expect(res.status).toBe(400);
      bodies.push(res.body);
    }
    expect(bodies[0]).toEqual(bodies[1]);
    expect(bodies[1]).toEqual(bodies[2]);
  });

  it("rejects weak passwords and the account's own email, and the link stays usable", async () => {
    const { email } = await makeUser();
    const token = await requestToken(email);
    const tooShort = await reset(token, "short");
    expect(tooShort.status).toBe(400);
    expect(tooShort.body.error).toBe("Use a password of at least 10 characters.");
    const sameAsEmail = await reset(token, email);
    expect(sameAsEmail.status).toBe(400);
    expect(sameAsEmail.body.error).toBe("Your password can't be your email address.");
    expect((await reset(token, email.toUpperCase())).status).toBe(400);
    expect((await reset(token, "x".repeat(201))).status).toBe(400);
    expect((await reset(token, 12345678901234)).status).toBe(400);
    expect((await pool.query("SELECT used_at FROM password_resets WHERE token_hash = $1", [crypto.createHash("sha256").update(token).digest()])).rows[0].used_at).toBeNull();
    expect((await login(email, PASSWORD)).res.status).toBe(200); // nothing changed yet
    expect((await reset(token, NEW_PASSWORD)).status).toBe(200);
  });

  it("rejects garbage tokens with a 400", async () => {
    const garbage = [undefined, null, 0, 42, true, {}, [], ["a"], { $ne: "" }, "", "short", "a".repeat(42), "a".repeat(44), "a".repeat(43) + "\n", `${"a".repeat(42)}=`, `${"a".repeat(42)}!`, "../".repeat(15), "' OR '1'='1", "%00".repeat(15)];
    for (const token of garbage) {
      const res = await reset(token, NEW_PASSWORD);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe(INVALID_LINK_MESSAGE);
    }
    expect((await request(app).post("/api/auth/reset").set(viaProxy()).send({})).status).toBe(400);
  });

  it("the hash of a token is not a token: the stored value can't be replayed", async () => {
    const { email, id } = await makeUser();
    await requestToken(email);
    const stored = (await pool.query("SELECT token_hash FROM password_resets WHERE user_id = $1 AND used_at IS NULL", [id])).rows[0].token_hash;
    for (const guess of [stored.toString("base64url"), stored.toString("hex")]) {
      expect((await reset(guess, NEW_PASSWORD)).status).toBe(400);
    }
  });

  it("two simultaneous submits of the same link: exactly one succeeds", async () => {
    const { email } = await makeUser();
    const token = await requestToken(email);
    const results = await Promise.all([
      reset(token, "first racing passphrase"),
      reset(token, "second racing passphrase"),
      reset(token, "third racing passphrase"),
    ]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 400, 400]);
    const winner = ["first", "second", "third"][results.findIndex((r) => r.status === 200)];
    expect((await login(email, `${winner} racing passphrase`)).res.status).toBe(200);
  });

  it("completing a reset also retires other outstanding links for that account", async () => {
    const { email, id } = await makeUser();
    const t1 = await requestToken(email);
    await pool.query("UPDATE password_resets SET used_at = NULL WHERE user_id = $1", [id]); // simulate two live links
    const t2 = await requestToken(email);
    await pool.query("UPDATE password_resets SET used_at = NULL WHERE user_id = $1", [id]);
    expect((await reset(t2, NEW_PASSWORD)).status).toBe(200);
    expect((await reset(t1, "yet another passphrase")).status).toBe(400);
  });

  it("is rate limited to 10 per address per 15 minutes", async () => {
    const ip = "198.51.100.88";
    const statuses = [];
    for (let i = 0; i < 12; i++) statuses.push((await reset(crypto.randomBytes(32).toString("base64url"), NEW_PASSWORD, ip)).status);
    expect(statuses.slice(0, 10).every((s) => s === 400)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
  });

  it("deleting the account removes its reset rows (ON DELETE CASCADE)", async () => {
    const { email, id } = await makeUser();
    await requestToken(email);
    await pool.query("DELETE FROM users WHERE id = $1", [id]);
    expect((await pool.query("SELECT 1 FROM password_resets WHERE user_id = $1", [id])).rows).toHaveLength(0);
  });
});
