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
  check("no console errors (CSP or runtime)", consoleErrors.length === 0);
  if (consoleErrors.length) console.log(consoleErrors);

  console.log(results.join("\n"));
  await browser.close();
})().catch((err) => {
  console.log(results.join("\n"));
  console.error("E2E crashed:", err.message);
  process.exit(1);
});
