// Records a scripted walkthrough of Tally for the LinkedIn video.
// Ama is filmed; Kwesi acts off-camera in his own browser context.
// Captions are drawn into the page itself, so they stay in sync with the footage.
// Usage: node e2e/record-demo.js [outDir]   (local stack must be running; see TESTING.md)
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE = "http://localhost:4173";
const PW = "correct horse battery";
const OUT = process.argv[2] || "/tmp/claude-0/videos";
const stamp = Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const OVERLAY = `
(() => {
  const mk = () => {
    if (document.getElementById("__cap")) return;
    const cap = document.createElement("div");
    cap.id = "__cap";
    const s = cap.style;
    s.cssText = "position:fixed;left:50%;bottom:34px;transform:translateX(-50%);max-width:78%;padding:14px 26px;border-radius:14px;background:rgba(20,24,31,.92);color:#fff;font:600 24px/1.35 system-ui,-apple-system,Segoe UI,sans-serif;text-align:center;z-index:2147483647;pointer-events:none;box-shadow:0 8px 30px rgba(0,0,0,.35);transition:opacity .25s;opacity:0";
    const dot = document.createElement("div");
    dot.id = "__dot";
    dot.style.cssText = "position:fixed;left:-50px;top:-50px;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:rgba(255,255,255,.9);border:3px solid #1d4ed8;z-index:2147483647;pointer-events:none;box-shadow:0 2px 8px rgba(0,0,0,.4);transition:transform .12s";
    document.documentElement.append(cap, dot);
    let t = ""; try { t = localStorage.getItem("__cap") || ""; } catch {}
    if (t) { cap.textContent = t; cap.style.opacity = 1; }
    const pos = JSON.parse(sessionStorage.getItem("__pos") || "null");
    if (pos) { dot.style.left = pos.x + "px"; dot.style.top = pos.y + "px"; }
    addEventListener("mousemove", (e) => { dot.style.left = e.clientX + "px"; dot.style.top = e.clientY + "px"; try { sessionStorage.setItem("__pos", JSON.stringify({ x: e.clientX, y: e.clientY })); } catch {} }, true);
    addEventListener("mousedown", () => (dot.style.transform = "scale(.65)"), true);
    addEventListener("mouseup", () => (dot.style.transform = "scale(1)"), true);
  };
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", mk); else mk();
})();`;

async function cap(page, text) {
  await page.evaluate((t) => {
    try { localStorage.setItem("__cap", t); } catch {}
    const c = document.getElementById("__cap");
    if (!c) return;
    c.style.opacity = 0;
    setTimeout(() => { c.textContent = t; c.style.opacity = t ? 1 : 0; }, 220);
  }, text);
}

async function moveTo(page, locator) {
  const box = await locator.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 22 });
  await sleep(250);
}
async function click(page, locator) { await moveTo(page, locator); await locator.click(); }
async function type(page, locator, text) { await moveTo(page, locator); await locator.click(); await locator.pressSequentially(text, { delay: 70 }); }

async function signupOffscreen(page, name) {
  await page.goto(`${BASE}/signup`);
  await page.getByLabel("Your name (what friends will see)").fill(name);
  await page.getByLabel("Email").fill(`${name.toLowerCase()}@demo.dev`);
  await page.getByLabel(/Password/).fill(PW);
  await page.getByRole("button", { name: "Create account" }).click();
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" }).catch(() => chromium.launch());
  const viewport = { width: 1440, height: 810 };
  const amaCtx = await browser.newContext({ viewport, recordVideo: { dir: OUT, size: viewport } });
  await amaCtx.addInitScript(OVERLAY);
  const kwesiCtx = await browser.newContext({ viewport });
  const ama = await amaCtx.newPage();
  const kwesi = await kwesiCtx.newPage();

  // 1. Sign up
  await ama.goto(`${BASE}/signup`);
  await ama.getByLabel("Email").waitFor();
  await cap(ama, "Everyone gets a real account — nothing is open by default");
  await sleep(1800);
  await type(ama, ama.getByLabel("Your name (what friends will see)"), "Ama");
  await type(ama, ama.getByLabel("Email"), "ama@demo.dev");
  await type(ama, ama.getByLabel(/Password/), PW);
  await sleep(500);
  await click(ama, ama.getByRole("button", { name: "Create account" }));
  await ama.getByRole("heading", { name: "Your tabs" }).waitFor();

  // 2. Create a tab
  await cap(ama, "Start a tab for a trip, a house or a dinner");
  await sleep(1500);
  await type(ama, ama.getByLabel("Tab name"), "Kumasi weekend");
  await sleep(500);
  await cap(ama, "Ghana cedis (GH₵) by default — or switch the tab to US dollars");
  await moveTo(ama, ama.getByRole("radio", { name: /US dollars/ }));
  await sleep(1400);
  await moveTo(ama, ama.getByRole("radio", { name: /Ghana cedis/ }));
  await sleep(2200);
  await click(ama, ama.getByRole("button", { name: "Start the tab" }));
  await ama.waitForURL(/\/tabs\//);
  const tabUrl = ama.url();
  await ama.getByLabel("Invite link").waitFor();
  const inviteLink = await ama.getByLabel("Invite link").inputValue();

  // 3. Invite link, Kwesi asks to join
  await cap(ama, "Share a private invite link. Anyone else just sees “Tab not found”");
  await moveTo(ama, ama.getByLabel("Invite link"));
  await sleep(3200);
  await cap(ama, "Meanwhile, Kwesi opens the link and asks to join…");
  await kwesi.goto(inviteLink);
  await kwesi.waitForURL(/\/login\?next=/);
  await kwesi.getByRole("link", { name: "Make an account" }).click();
  await kwesi.getByLabel("Your name (what friends will see)").fill("Kwesi");
  await kwesi.getByLabel("Email").fill("kwesi@demo.dev");
  await kwesi.getByLabel(/Password/).fill(PW);
  await kwesi.getByRole("button", { name: "Create account" }).click();
  await kwesi.getByRole("button", { name: "Ask to join" }).click();
  await kwesi.getByText(/Request sent/).waitFor();
  await ama.reload();
  await ama.getByRole("button", { name: "Let in" }).waitFor();
  await cap(ama, "The owner decides who gets in");
  await sleep(2200);
  await click(ama, ama.getByRole("button", { name: "Let in" }));
  await ama.getByText("Kwesi", { exact: true }).first().waitFor();
  await sleep(1200);

  // 4. Add a $30 dinner
  await cap(ama, "Add something you paid for, split between everyone");
  await click(ama, ama.getByRole("button", { name: "+ Add something you paid for" }));
  await type(ama, ama.getByLabel("What was it for"), "Jollof dinner");
  await type(ama, ama.getByLabel("Amount you paid"), "120");
  await sleep(600);
  await click(ama, ama.getByRole("button", { name: "Add to the tab" }));
  await ama.getByText(/Kwesi: hasn't accepted yet/).waitFor();
  await cap(ama, "It stays pending — no one can bill a friend without their OK");
  await sleep(3800);

  // 5. Kwesi accepts
  await cap(ama, "Kwesi accepts his share…");
  await kwesi.goto(tabUrl);
  await kwesi.getByText("Needs your OK").waitFor();
  await sleep(1200);
  await kwesi.getByRole("button", { name: "Accept" }).click();
  await kwesi.getByText("You owe GH₵60.00").waitFor();
  await ama.reload();
  await ama.getByText("You're owed GH₵60.00").waitFor();
  await cap(ama, "Now the debt counts, and both sides see the same balance");
  await sleep(3800);

  // 6. A fake expense gets disputed
  await cap(ama, "Someone tries a fake charge? The other person can dispute it");
  await kwesi.getByRole("button", { name: "+ Add something you paid for" }).click();
  await kwesi.getByLabel("What was it for").fill("Totally real");
  await kwesi.getByLabel("Amount you paid").fill("60");
  await kwesi.getByRole("checkbox", { name: "You" }).uncheck();
  await kwesi.getByRole("button", { name: "Add to the tab" }).click();
  await kwesi.getByText(/Ama: hasn't accepted yet/).waitFor();
  await ama.reload();
  await ama.getByText("Needs your OK").waitFor();
  await sleep(1200);
  await click(ama, ama.getByRole("button", { name: "Decline" }));
  await sleep(500);
  await click(ama, ama.getByRole("button", { name: "Yes" }));
  await ama.getByText("You: disputes this").waitFor();
  await sleep(3200);

  // 7. Settle up
  await cap(ama, "Settling up takes two sides: “I've paid” — then “I got it”");
  await kwesi.reload();
  await kwesi.getByRole("button", { name: "I've paid this" }).click();
  await kwesi.getByRole("button", { name: "Yes" }).click();
  await kwesi.getByText(/Waiting for Ama to confirm/).waitFor();
  await ama.reload();
  await ama.getByText(/says they paid you/).waitFor();
  await sleep(2000);
  await click(ama, ama.getByRole("button", { name: "Yes, I got it" }));
  await ama.getByText("You're square").waitFor();
  await cap(ama, "Everyone is square.");
  await sleep(3500);
  await cap(ama, "");
  await sleep(600);

  const video = ama.video();
  await amaCtx.close();
  const p = await video.path();
  fs.renameSync(p, path.join(OUT, "tally-raw.webm"));
  await browser.close();
  console.log("saved", path.join(OUT, "tally-raw.webm"));
})().catch((e) => { console.error(e); process.exit(1); });
