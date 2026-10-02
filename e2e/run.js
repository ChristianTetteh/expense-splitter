const { chromium } = require("playwright");

const BASE = "http://localhost:4173";
const PW = "correct horse battery";
const stamp = Date.now();
const results = [];
const check = (name, cond) => {
  results.push(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (!cond) process.exitCode = 1;
};

async function signup(page, name) {
  await page.goto(`${BASE}/signup`);
  await page.getByLabel("Your name (what friends will see)").fill(name);
  await page.getByLabel("Email").fill(`${name.toLowerCase()}${stamp}@e2e.dev`);
  await page.getByLabel(/Password/).fill(PW);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByRole("heading", { name: "Your tabs" }).waitFor();
}

(async () => {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" }).catch(() => chromium.launch());
  const amaCtx = await browser.newContext();
  const kwesiCtx = await browser.newContext();
  const strangerCtx = await browser.newContext();
  const ama = await amaCtx.newPage();
  const kwesi = await kwesiCtx.newPage();
  const stranger = await strangerCtx.newPage();
  const consoleErrors = [];
  const csp = JSON.parse(require("fs").readFileSync(require("path").join(__dirname, "..", "frontend", "vercel.json"), "utf8"))
    .headers[0].headers.find((h) => h.key === "Content-Security-Policy").value.replace("upgrade-insecure-requests", "");
  for (const ctx of [amaCtx, kwesiCtx, strangerCtx]) {
    // Serve every page with the production CSP, as Vercel will.
    await ctx.route("**/*", async (route) => {
      if (route.request().resourceType() !== "document") return route.continue();
      const res = await route.fetch();
      await route.fulfill({ response: res, headers: { ...res.headers(), "content-security-policy": csp } });
    });
  }
  const expected = /ERR_TUNNEL_CONNECTION_FAILED|status of 40[149]/; // fonts blocked in sandbox; deliberate 401/404s
  for (const p of [ama, kwesi, stranger]) p.on("console", (m) => m.type() === "error" && !expected.test(m.text()) && consoleErrors.push(m.text()));

  // Logged-out visitors are sent to login.
  await stranger.goto(`${BASE}/`);
  await stranger.waitForURL(/\/login/);
  check("logged-out visitor is redirected to /login", stranger.url().includes("/login"));

  // Open-redirect attempt through ?next=
  await signup(stranger, "Stranger");
  await stranger.getByRole("button", { name: "Log out" }).click();
  await stranger.goto(`${BASE}/login?next=${encodeURIComponent("/\\evil.example")}`);
  await stranger.getByLabel("Email").fill(`stranger${stamp}@e2e.dev`);
  await stranger.getByLabel(/Password/).fill(PW);
  await stranger.getByRole("button", { name: "Log in" }).click();
  await stranger.getByRole("heading", { name: "Your tabs" }).waitFor();
  check("?next=/\\evil.example stays on this site", new URL(stranger.url()).host === "localhost:4173");

  // Session cookie is HttpOnly (invisible to page scripts).
  const visible = await stranger.evaluate(() => document.cookie);
  check("session cookie not readable by JavaScript", !visible.includes("tally_session"));

  // Ama creates a tab.
  await signup(ama, "Ama");
  await ama.getByLabel("Tab name").fill("Kumasi weekend");
  await ama.getByRole("button", { name: "Start the tab" }).click();
  await ama.waitForURL(/\/tabs\//);
  const tabUrl = ama.url();
  const inviteLink = await ama.getByLabel("Invite link").inputValue();
  check("owner sees an invite link", /\/join\/[A-Za-z0-9_-]{32}$/.test(inviteLink));

  // Stranger guesses the tab URL directly.
  await stranger.goto(tabUrl);
  await stranger.getByText("Tab not found.").waitFor();
  check("non-member opening the tab URL sees 'Tab not found.'", true);

  // Kwesi signs up through the invite link (login redirect carries ?next).
  await kwesi.goto(inviteLink);
  await kwesi.waitForURL(/\/login\?next=/);
  await kwesi.getByRole("link", { name: "Make an account" }).click();
  await kwesi.getByLabel("Your name (what friends will see)").fill("Kwesi");
  await kwesi.getByLabel("Email").fill(`kwesi${stamp}@e2e.dev`);
  await kwesi.getByLabel(/Password/).fill(PW);
  await kwesi.getByRole("button", { name: "Create account" }).click();
  await kwesi.getByRole("heading", { name: "Kumasi weekend" }).waitFor();
  check("after signup, invitee lands back on the invite page", kwesi.url().includes("/join/"));
  await kwesi.getByRole("button", { name: "Ask to join" }).click();
  await kwesi.getByText(/Request sent/).waitFor();

  // Before approval Kwesi still can't see the tab.
  await kwesi.goto(tabUrl);
  await kwesi.getByText("Tab not found.").waitFor();
  check("requester can't see the tab before approval", true);

  // Ama approves (she sees his email).
  await ama.reload();
  await ama.getByText(`kwesi${stamp}@e2e.dev`).waitFor();
  check("owner sees the requester's email", true);
  await ama.getByRole("button", { name: "Let in" }).click();
  await ama.getByText("Kwesi", { exact: true }).first().waitFor();

  // Ama adds a $30 dinner split with both.
  await ama.getByRole("button", { name: "+ Add something you paid for" }).click();
  await ama.getByLabel("What was it for").fill("Dinner");
  await ama.getByLabel("Amount you paid").fill("30");
  await ama.getByRole("button", { name: "Add to the tab" }).click();
  await ama.getByText(/Kwesi: hasn't accepted yet/).waitFor();
  check("a new charge is pending until the other person accepts", await ama.getByText("You're square").isVisible());

  // Kwesi accepts his share.
  await kwesi.goto(tabUrl);
  await kwesi.getByText("Needs your OK").waitFor();
  await kwesi.getByRole("button", { name: "Accept" }).click();
  await kwesi.getByText("You owe $15.00").waitFor();
  await ama.reload();
  await ama.getByText("You're owed $15.00").waitFor();
  check("after accepting, the debt counts on both sides", true);

  // Kwesi tries the fake-expense trick: a $15 "expense" charged only to Ama.
  await kwesi.getByRole("button", { name: "+ Add something you paid for" }).click();
  await kwesi.getByLabel("What was it for").fill("Totally real");
  await kwesi.getByLabel("Amount you paid").fill("15");
  await kwesi.getByRole("checkbox", { name: "You" }).uncheck();
  await kwesi.getByRole("button", { name: "Add to the tab" }).click();
  await kwesi.getByText(/Ama: hasn't accepted yet/).waitFor();
  check("fake expense doesn't touch his debt", await kwesi.getByText("You owe $15.00").isVisible());
  await ama.reload();
  await ama.getByText("Needs your OK").waitFor();
  await ama.getByRole("button", { name: "Decline" }).click();
  await ama.getByRole("button", { name: "Yes" }).click();
  await ama.getByText("You: disputes this").waitFor();
  await kwesi.reload();
  await kwesi.getByText("Ama: disputes this").waitFor();
  check("creditor's decline is visible to him and the debt stands", await kwesi.getByText("You owe $15.00").isVisible());
  const dinnerRow = kwesi.getByRole("listitem").filter({ hasText: "Dinner" }).filter({ hasText: "Ama paid" });
  const voidButtons = await dinnerRow.getByRole("button", { name: "void" }).count();
  check("debtor gets no 'void' button on someone else's expense", voidButtons === 0);
  check("debtor sees no invite link", (await kwesi.getByLabel("Invite link").count()) === 0);

  // Kwesi claims he paid → still owes until Ama confirms.
  await kwesi.getByRole("button", { name: "I've paid this" }).click();
  await kwesi.getByRole("button", { name: "Yes" }).click();
  await kwesi.getByText(/Waiting for Ama to confirm/).waitFor();
  check("debtor's claim is pending and he still owes", await kwesi.getByText("You owe $15.00").isVisible());

  await ama.reload();
  await ama.getByText(/says they paid you/).waitFor();
  await ama.getByRole("button", { name: "Yes, I got it" }).click();
  await ama.getByText("You're square").waitFor();
  await kwesi.reload();
  await kwesi.getByText("You're square").waitFor();
  check("after the receiver confirms, both are square", true);

  // Stranger's list doesn't include Ama's tab.
  await stranger.goto(`${BASE}/`);
  await stranger.getByText(/No tabs yet/).waitFor();
  check("stranger's tab list is empty", true);

  // Kwesi is square now, but his disputed fake charge to Ama blocks leaving.
  await kwesi.reload();
  await kwesi.getByRole("button", { name: "Leave this tab" }).click();
  await kwesi.getByRole("button", { name: "Yes" }).click();
  await kwesi.getByText(/disputed charge — resolve it first/).waitFor();
  check("an open dispute blocks leaving", true);
  await kwesi.getByRole("button", { name: "Withdraw the charge" }).click();
  await kwesi.getByRole("button", { name: "Yes" }).click();
  await kwesi.getByText("Ama: charge withdrawn").waitFor();

  // Kwesi (now square) can leave and then loses access.
  await kwesi.getByRole("button", { name: "Leave this tab" }).click();
  await kwesi.getByRole("button", { name: "Yes" }).click();
  await kwesi.getByRole("heading", { name: "Your tabs" }).waitFor();
  await kwesi.goto(tabUrl);
  await kwesi.getByText("Tab not found.").waitFor();
  check("after leaving, the tab is gone for him", true);

  await ama.screenshot({ path: __dirname + "/ama-tab.png", fullPage: true });
  // ── Password reset ────────────────────────────────────────────────────
  // Mail never leaves the machine: the backend is started with MAIL_OUTBOX_FILE,
  // which makes it append each message to a file instead of sending it.
  const fs = require("fs");
  const OUTBOX = process.env.MAIL_OUTBOX_FILE || "/tmp/claude-0/outbox.jsonl";
  const amaEmail = `ama${stamp}@e2e.dev`;
  const NEW_PW = "my brand new passphrase";
  const mailsTo = (addr) =>
    (fs.existsSync(OUTBOX) ? fs.readFileSync(OUTBOX, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []).filter((m) => m.to === addr);
  const waitForMail = async (addr, count) => {
    for (let i = 0; i < 50; i++) {
      const m = mailsTo(addr);
      if (m.length >= count) return m[m.length - 1];
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`no mail #${count} for ${addr}`);
  };

  const phoneCtx = await browser.newContext(); // a second, separate device for Ama
  const resetCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  for (const ctx of [phoneCtx, resetCtx]) {
    await ctx.route("**/*", async (route) => {
      if (route.request().resourceType() !== "document") return route.continue();
      const res = await route.fetch();
      await route.fulfill({ response: res, headers: { ...res.headers(), "content-security-policy": csp } });
    });
  }
  const phone = await phoneCtx.newPage();
  const fresh = await resetCtx.newPage();
  // Only the deliberate wrong-password / used-link responses are tolerated here.
  const resetExpected = /ERR_TUNNEL_CONNECTION_FAILED|status of 40[01]/;
  const requestedUrls = [];
  for (const p of [phone, fresh]) p.on("console", (m) => m.type() === "error" && !resetExpected.test(m.text()) && consoleErrors.push(m.text()));
  fresh.on("request", (r) => requestedUrls.push(r.url()));

  await phone.goto(`${BASE}/login`);
  await phone.getByLabel("Email").fill(amaEmail);
  await phone.getByLabel(/Password/).fill(PW);
  await phone.getByRole("button", { name: "Log in" }).click();
  await phone.getByRole("heading", { name: "Your tabs" }).waitFor();

  // Request the link from the login page, as a logged-out visitor would.
  await fresh.goto(`${BASE}/login`);
  await fresh.getByRole("link", { name: "Forgot your password?" }).click();
  await fresh.waitForURL(/\/forgot$/);
  await fresh.getByLabel("Email").fill(amaEmail);
  await fresh.getByRole("button", { name: "Send reset link" }).click();
  const genericText = "If that email has an account, a reset link is on its way. It works for 30 minutes.";
  await fresh.getByText(genericText).waitFor();
  const forAma = await fresh.getByText(genericText).textContent();

  // An address with no account gets the very same page.
  await fresh.goto(`${BASE}/forgot`);
  await fresh.getByLabel("Email").fill(`nobody${stamp}@e2e.dev`);
  await fresh.getByRole("button", { name: "Send reset link" }).click();
  await fresh.getByText(genericText).waitFor();
  check("forgot page shows the same confirmation for a real and an unknown email", forAma === (await fresh.getByText(genericText).textContent()));
  await new Promise((r) => setTimeout(r, 500));
  check("no email is sent for the unknown address", mailsTo(`nobody${stamp}@e2e.dev`).length === 0);

  const mail = await waitForMail(amaEmail, 1);
  const link = mail.text.match(/https?:\/\/\S+/)[0];
  const token = new URL(link).hash.slice(1);
  check("reset email links to the app origin with the token in the #fragment", link.startsWith(`${BASE}/reset#`) && /^[A-Za-z0-9_-]{43}$/.test(token));

  await fresh.goto(link);
  await fresh.getByRole("heading", { name: "Choose a new password" }).waitFor();
  check("the token is stripped from the address bar", !fresh.url().includes(token) && (await fresh.evaluate(() => location.hash)) === "");

  await fresh.getByLabel("New password (10+ characters)").fill(NEW_PW);
  await fresh.getByLabel("Confirm new password").fill(NEW_PW + "x");
  await fresh.getByRole("button", { name: "Change password" }).click();
  await fresh.getByText("The two passwords don't match.").waitFor();
  await fresh.getByLabel("New password (10+ characters)").fill("short");
  await fresh.getByLabel("Confirm new password").fill("short");
  await fresh.getByRole("button", { name: "Change password" }).click();
  await fresh.getByText("Use a password of at least 10 characters.").waitFor();
  check("a mismatched or too-short password is refused and the form stays open", await fresh.getByRole("button", { name: "Change password" }).isVisible());

  await fresh.screenshot({ path: __dirname + "/reset-form-390.png" });
  await fresh.getByLabel("New password (10+ characters)").fill(NEW_PW);
  await fresh.getByLabel("Confirm new password").fill(NEW_PW);
  await fresh.getByRole("button", { name: "Change password" }).click();
  await fresh.getByText("Password changed. Log in with your new password.").waitFor();
  check("after resetting, the user lands on /login with a notice", fresh.url().endsWith("/login"));

  await fresh.getByLabel("Email").fill(amaEmail);
  await fresh.getByLabel(/Password/).fill(PW);
  await fresh.getByRole("button", { name: "Log in" }).click();
  await fresh.getByText("Email or password is incorrect.").waitFor();
  check("the old password no longer works", fresh.url().endsWith("/login"));
  await fresh.getByLabel(/Password/).fill(NEW_PW);
  await fresh.getByRole("button", { name: "Log in" }).click();
  await fresh.getByRole("heading", { name: "Your tabs" }).waitFor();
  check("the new password works", true);

  await phone.reload();
  await phone.waitForURL(/\/login/);
  await ama.reload();
  await ama.waitForURL(/\/login/);
  check("Ama's other sessions were logged out by the reset", phone.url().includes("/login") && ama.url().includes("/login"));

  // The used link is dead and says what to do next.
  await fresh.getByRole("button", { name: "Log out" }).click();
  await fresh.goto(link);
  await fresh.getByLabel("New password (10+ characters)").fill(NEW_PW + "2");
  await fresh.getByLabel("Confirm new password").fill(NEW_PW + "2");
  await fresh.getByRole("button", { name: "Change password" }).click();
  await fresh.getByText(/This reset link is invalid or has expired/).waitFor();
  await fresh.getByRole("link", { name: "Request a new link" }).waitFor();
  check("a used link shows 'invalid or expired' with a 'Request a new link' action", true);
  await fresh.screenshot({ path: __dirname + "/reset-invalid-390.png" });
  await fresh.goto(`${BASE}/reset`);
  await fresh.getByRole("link", { name: "Request a new link" }).waitFor();
  check("opening /reset with no token shows the same dead-end state", true);
  check("the token never appeared in any request URL the browser made", !requestedUrls.some((u) => u.includes(token)));
  const overflow = await fresh.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  check("reset pages fit a 390px screen without sideways scrolling", !overflow);

  check("no console errors (CSP or runtime)", consoleErrors.length === 0);
  if (consoleErrors.length) console.log(consoleErrors);

  console.log(results.join("\n"));
  await browser.close();
})().catch((err) => {
  console.log(results.join("\n"));
  console.error("E2E crashed:", err.message);
  process.exit(1);
});
