const { app, pool, request, PASSWORD, resetDb, newUser } = require("./helpers");
const { hashToken } = require("../lib/sessions");

beforeAll(resetDb);
afterAll(() => pool.end());

const sessionCookie = (res) => (res.headers["set-cookie"] || []).find((c) => c.startsWith("tally_session="));

describe("signup", () => {
  it("creates the account, logs you in with an HttpOnly SameSite cookie, and never returns the hash", async () => {
    const res = await request(app)
      .post("/api/auth/signup")
      .send({ email: "Esi@Example.com", display_name: "Esi", password: PASSWORD });
    expect(res.status).toBe(201);
    expect(res.body.user).toEqual({ id: expect.any(Number), email: "esi@example.com", display_name: "Esi" });
    expect(JSON.stringify(res.body)).not.toMatch(/scrypt|password/i);

    const cookie = sessionCookie(res);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Path=\//);
  });

  it("stores a salted scrypt hash, not the password", async () => {
    const row = (await pool.query("SELECT password_hash FROM users WHERE email = 'esi@example.com'")).rows[0];
    expect(row.password_hash).toMatch(/^scrypt\$32768\$8\$1\$/);
    expect(row.password_hash).not.toContain(PASSWORD);
  });

  it("stores only a hash of the session token", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "esi@example.com", password: PASSWORD });
    const token = sessionCookie(res).split(";")[0].split("=")[1];
    const raw = await pool.query("SELECT 1 FROM sessions WHERE token_hash = $1", [Buffer.from(token)]);
    const hashed = await pool.query("SELECT 1 FROM sessions WHERE token_hash = $1", [hashToken(token)]);
    expect(raw.rows).toHaveLength(0);
    expect(hashed.rows).toHaveLength(1);
  });

  it("rejects a second account for the same email, whatever its case", async () => {
    const res = await request(app)
      .post("/api/auth/signup")
      .send({ email: "ESI@example.COM", display_name: "Imposter", password: PASSWORD });
    expect(res.status).toBe(409);
  });
});

describe("login", () => {
  it("gives the identical answer for a wrong password and an unknown email", async () => {
    const wrongPw = await request(app).post("/api/auth/login").send({ email: "esi@example.com", password: "not the password" });
    const noUser = await request(app).post("/api/auth/login").send({ email: "ghost@example.com", password: "not the password" });
    expect(wrongPw.status).toBe(401);
    expect(noUser.status).toBe(401);
    expect(wrongPw.body).toEqual(noUser.body);
    expect(sessionCookie(wrongPw)).toBeUndefined();
  });

  it("ignores injection-shaped payloads", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "esi@example.com", password: { $ne: "" } });
    expect(res.status).toBe(401);
    const sqli = await request(app).post("/api/auth/login").send({ email: "' OR '1'='1", password: "' OR '1'='1" });
    expect(sqli.status).toBe(401);
  });

  it("issues a fresh token on every login (no session fixation)", async () => {
    const a = await request(app).post("/api/auth/login").send({ email: "esi@example.com", password: PASSWORD });
    const b = await request(app).post("/api/auth/login").send({ email: "esi@example.com", password: PASSWORD });
    expect(sessionCookie(a)).not.toEqual(sessionCookie(b));
  });
});

describe("sessions", () => {
  it("rejects requests with no cookie, a forged cookie, or a malformed one", async () => {
    expect((await request(app).get("/api/auth/me")).status).toBe(401);
    expect((await request(app).get("/api/auth/me").set("Cookie", `tally_session=${"A".repeat(43)}`)).status).toBe(401);
    expect((await request(app).get("/api/auth/me").set("Cookie", "tally_session=' OR 1=1 --")).status).toBe(401);
  });

  it("logout kills the session on the server, not just in the browser", async () => {
    const u = await newUser("Kofi");
    const login = await request(app).post("/api/auth/login").send({ email: u.email, password: PASSWORD });
    const cookie = sessionCookie(login).split(";")[0];

    expect((await request(app).get("/api/auth/me").set("Cookie", cookie)).status).toBe(200);
    await request(app).post("/api/auth/logout").set("Cookie", cookie).send({});
    // Replaying the old cookie after logout must fail.
    expect((await request(app).get("/api/auth/me").set("Cookie", cookie)).status).toBe(401);
  });

  it("expired sessions stop working", async () => {
    const u = await newUser("Yaw");
    await pool.query("UPDATE sessions SET expires_at = now() - interval '1 second' WHERE user_id = $1", [u.user.id]);
    expect((await u.agent.get("/api/auth/me")).status).toBe(401);
  });

  it("every tab and invite endpoint requires a session", async () => {
    const id = "3f2b8c1e-9a4d-4e2f-8b1a-0c9d8e7f6a5b";
    const anon = request(app);
    expect((await anon.get("/api/groups")).status).toBe(401);
    expect((await anon.get(`/api/groups/${id}`)).status).toBe(401);
    expect((await anon.post("/api/groups").send({ name: "x" })).status).toBe(401);
    expect((await anon.post(`/api/groups/${id}/expenses`).send({})).status).toBe(401);
    expect((await anon.get(`/api/invites/${"A".repeat(32)}`)).status).toBe(401);
  });
});

describe("cross-site request forgery", () => {
  it("refuses form-encoded or plain-text writes", async () => {
    const u = await newUser("Abena");
    const form = await u.agent.post("/api/groups").type("form").send("name=Hijacked");
    const text = await u.agent.post("/api/groups").set("Content-Type", "text/plain").send('{"name":"Hijacked"}');
    expect(form.status).toBe(415);
    expect(text.status).toBe(415);
  });

  it("refuses writes from another site's Origin or a cross-site fetch", async () => {
    const u = await newUser("Akua");
    const evil = await u.agent.post("/api/groups").set("Origin", "https://evil.example").send({ name: "Hijacked" });
    const xsite = await u.agent.post("/api/groups").set("Sec-Fetch-Site", "cross-site").send({ name: "Hijacked" });
    expect(evil.status).toBe(403);
    expect(xsite.status).toBe(403);
    const ok = await u.agent.post("/api/groups").set("Origin", "http://localhost:5173").send({ name: "Legit" });
    expect(ok.status).toBe(201);
  });

  it("sends no CORS headers, so other sites' scripts can't read responses", async () => {
    const res = await request(app).get("/api/health").set("Origin", "https://evil.example");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("transport hygiene", () => {
  it("marks every response no-store and sets security headers", async () => {
    const res = await request(app).get("/api/health");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("rejects oversized and malformed bodies without leaking internals", async () => {
    const big = await request(app).post("/api/auth/login").send({ email: "a@b.co", password: "x".repeat(20_000) });
    expect(big.status).toBe(413);
    const bad = await request(app).post("/api/auth/login").set("Content-Type", "application/json").send("{not json");
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body)).not.toMatch(/at |stack|SyntaxError/);
  });
});
