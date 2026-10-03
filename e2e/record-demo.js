// Records a scripted walkthrough of Tally for the demo video.
// Ama is filmed; Kwesi acts off-camera in his own browser context.
//
// Output (in OUT): frames/*.jpg captured with the Chrome DevTools screencast
// (much sharper than Playwright's built-in recorder), plus timeline.json with
// the frame timestamps, caption changes and "freeze" moments (a sharp
// screenshot and the box of the feature to spotlight). e2e/video/build_video.py
// turns that into the finished video.
// Usage: node e2e/record-demo.js [outDir]   (local stack must be running; see TESTING.md)
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE = "http://localhost:4173";
const PW = "correct horse battery";
const OUT = process.argv[2] || "/tmp/claude-0/videos/tally";
// The page is laid out as if 1536x744 but drawn at 1920x930 by zooming the
// whole document 1.25x, so the screencast captures full-resolution frames.
const ZOOM = 1.25;
const SCALE = 1; // element boxes are already in 1920x930 frame pixels
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now() / 1000;

const timeline = { scale: SCALE, frames: [], captions: [], freezes: [] };

// Page zoom, plus a visible cursor (headless Chrome draws none) kept across page loads.
const CURSOR = `
(() => {
  const Z = ${ZOOM};
  const zoom = () => document.documentElement && (document.documentElement.style.zoom = String(Z));
  zoom();
  const mk = () => {
    zoom();
    if (document.getElementById("__dot")) return;
    const dot = document.createElement("div");
    dot.id = "__dot";
    dot.style.cssText = "position:fixed;left:-50px;top:-50px;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:rgba(255,255,255,.92);border:3px solid #1d3fbb;z-index:2147483647;pointer-events:none;box-shadow:0 2px 8px rgba(0,0,0,.35);transition:transform .12s";
    document.documentElement.append(dot);
    const pos = JSON.parse(sessionStorage.getItem("__pos") || "null");
    if (pos) { dot.style.left = pos.x / Z + "px"; dot.style.top = pos.y / Z + "px"; }
    addEventListener("mousemove", (e) => { dot.style.left = e.clientX / Z + "px"; dot.style.top = e.clientY / Z + "px"; try { sessionStorage.setItem("__pos", JSON.stringify({ x: e.clientX, y: e.clientY })); } catch {} }, true);
    addEventListener("mousedown", () => (dot.style.transform = "scale(.65)"), true);
    addEventListener("mouseup", () => (dot.style.transform = "scale(1)"), true);
  };
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", mk); else mk();
})();`;

const cap = (text) => timeline.captions.push({ t: now(), text });

async function moveTo(page, locator) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 22 });
  await sleep(250);
}
// Point at an element's bottom-right corner, so the cursor doesn't cover its label.
async function pointAt(page, locator) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  await page.mouse.move(box.x + box.width - 3, box.y + box.height + 3, { steps: 22 });
  await sleep(250);
}
async function click(page, locator) { await moveTo(page, locator); await locator.click(); }
async function type(page, locator, text) { await moveTo(page, locator); await locator.click(); await locator.pressSequentially(text, { delay: 70 }); }

// Pause the action on a feature: the video freezes here, spotlights `locator`
// and shows a callout with `title` and `body`.
let freezeN = 0;
async function freeze(page, locator, title, body) {
  await locator.scrollIntoViewIfNeeded();
  await sleep(700); // let scrolling and transitions settle so the frame is still
  const b = await locator.boundingBox();
  const shot = path.join(OUT, `freeze${++freezeN}.png`);
  const t = now();
  await page.screenshot({ path: shot });
  timeline.freezes.push({ t, shot, title, body, box: [b.x, b.y, b.width, b.height].map((v) => v * SCALE) });
  await sleep(500);
}

(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, "frames"), { recursive: true });
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" }).catch(() => chromium.launch());
  const amaCtx = await browser.newContext({ viewport: { width: 1920, height: 930 } });
  await amaCtx.addInitScript(CURSOR);
  const kwesiCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const ama = await amaCtx.newPage();
  const kwesi = await kwesiCtx.newPage();

  const cdp = await amaCtx.newCDPSession(ama);
  let n = 0;
  cdp.on("Page.screencastFrame", async ({ data, metadata, sessionId }) => {
    const file = path.join(OUT, "frames", `${String(++n).padStart(5, "0")}.jpg`);
    fs.writeFileSync(file, Buffer.from(data, "base64"));
    timeline.frames.push({ file, t: metadata.timestamp });
    cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  });

  await ama.goto(`${BASE}/signup`);
  await ama.getByLabel("Email").waitFor();
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: 1920, maxHeight: 930, everyNthFrame: 1 });
  timeline.start = now();
  await sleep(600);

  // 1. Sign up
  cap("Sign up with a name, an email and a password");
  await sleep(1200);
  await type(ama, ama.getByLabel("Your name (what friends will see)"), "Ama");
  await type(ama, ama.getByLabel("Email"), "ama@example.com");
  await type(ama, ama.getByLabel(/Password/), PW);
  await sleep(400);
  await click(ama, ama.getByRole("button", { name: "Create account" }));
  await ama.getByRole("heading", { name: "Your tabs" }).waitFor();

  // 2. Create a tab in cedis
  cap("Start a tab for a trip, a house or a dinner");
  await sleep(900);
  await type(ama, ama.getByLabel("Tab name"), "Kumasi weekend");
  await sleep(400);
  const currency = ama.locator("fieldset", { hasText: "Currency" });
  await pointAt(ama, ama.getByRole("radio", { name: /Ghana cedis/ }));
  await freeze(ama, currency, "One currency per tab",
    "Ghana cedis is the default, and US dollars is one tap away. It's locked once the tab exists, so amounts never change meaning.");
  await click(ama, ama.getByRole("button", { name: "Start the tab" }));
  await ama.waitForURL(/\/tabs\//);
  const tabUrl = ama.url();
  await ama.getByLabel("Invite link").waitFor();
  const inviteLink = await ama.getByLabel("Invite link").inputValue();

  // 3. Invite link, Kwesi asks to join
  cap("Share the tab's invite link");
  await pointAt(ama, ama.getByLabel("Invite link"));
  await freeze(ama, ama.locator("section.owner-panel"), "Private by invite",
    "Only people with this link can ask to join. Anyone else who opens the tab just sees “Tab not found”.");
  cap("Kwesi opens the link and asks to join");
  await kwesi.goto(inviteLink);
  await kwesi.waitForURL(/\/login\?next=/);
  await kwesi.getByRole("link", { name: "Make an account" }).click();
  await kwesi.getByLabel("Your name (what friends will see)").fill("Kwesi");
  await kwesi.getByLabel("Email").fill("kwesi@example.com");
  await kwesi.getByLabel(/Password/).fill(PW);
  await kwesi.getByRole("button", { name: "Create account" }).click();
  await kwesi.getByRole("button", { name: "Ask to join" }).click();
  await kwesi.getByText(/Request sent/).waitFor();
  await ama.reload();
  await ama.getByRole("button", { name: "Let in" }).waitFor();
  await pointAt(ama, ama.getByRole("button", { name: "Let in" }));
  await freeze(ama, ama.locator("section.join-requests"), "The owner decides who gets in",
    "Each request shows the person's name and email, so Ama knows exactly who she is adding.");
  await click(ama, ama.getByRole("button", { name: "Let in" }));
  await ama.getByText("Kwesi", { exact: true }).first().waitFor();
  await sleep(900);

  // 4. Add a GH₵120 dinner
  cap("Ama adds a GH₵120 Jollof dinner, split evenly");
  await click(ama, ama.getByRole("button", { name: "+ Add something you paid for" }));
  await type(ama, ama.getByLabel("What was it for"), "Jollof dinner");
  await type(ama, ama.getByLabel("Amount you paid"), "120");
  await sleep(500);
  await click(ama, ama.getByRole("button", { name: "Add to the tab" }));
  await ama.getByText(/Kwesi: hasn't accepted yet/).waitFor();
  await sleep(400);
  const dinner = ama.locator("li.entry", { hasText: "Jollof dinner" });
  await pointAt(ama, dinner);
  await freeze(ama, dinner, "Nothing counts without consent",
    "Ama paid GH₵120, but Kwesi's GH₵60 share stays pending until he accepts it. No one can quietly add a debt to a friend.");

  // 5. Kwesi accepts
  cap("Kwesi accepts his share");
  await kwesi.goto(tabUrl);
  await kwesi.getByText("Needs your OK").waitFor();
  await kwesi.getByRole("button", { name: "Accept" }).click();
  await kwesi.getByText("You owe GH₵60.00").waitFor();
  await ama.reload();
  await ama.getByText("You're owed GH₵60.00").waitFor();
  await ama.evaluate(() => scrollTo(0, 0));
  await sleep(600);
  const balance = ama.locator("section.balance");
  await pointAt(ama, ama.locator(".balance-amount"));
  await freeze(ama, balance, "Only agreed amounts count",
    "Balances use accepted shares only, worked out in whole pesewas so every split adds up exactly. Both sides see the same number.");

  // 6. A fake charge gets disputed
  cap("Kwesi tries a fake GH₵60 charge, and Ama disputes it");
  await kwesi.getByRole("button", { name: "+ Add something you paid for" }).click();
  await kwesi.getByLabel("What was it for").fill("Totally real");
  await kwesi.getByLabel("Amount you paid").fill("60");
  await kwesi.getByRole("checkbox", { name: "You" }).uncheck();
  await kwesi.getByRole("button", { name: "Add to the tab" }).click();
  await kwesi.getByText(/Ama: hasn't accepted yet/).waitFor();
  await ama.reload();
  await ama.getByText("Needs your OK").waitFor();
  await ama.evaluate(() => scrollTo(0, 0));
  const fake = ama.locator("section.needs-you li.ask", { hasText: "Totally real" });
  await pointAt(ama, fake.getByRole("button", { name: "Decline" }));
  await freeze(ama, fake, "Disputes stay visible",
    "Kwesi charged Ama for something fake. She can decline it, everyone sees the dispute, and neither of them can leave the tab until it's resolved.");
  await click(ama, fake.getByRole("button", { name: "Decline" }));
  await sleep(500);
  await click(ama, ama.getByRole("button", { name: "Yes" }));
  await ama.getByText("You: disputes this").waitFor();
  await sleep(1800);

  // 7. Settle up
  cap("Kwesi pays Ama back, and Ama confirms she got it");
  await kwesi.reload();
  await kwesi.getByRole("button", { name: "I've paid this" }).click();
  await kwesi.getByRole("button", { name: "Yes" }).click();
  await kwesi.getByText(/Waiting for Ama to confirm/).waitFor();
  await ama.reload();
  await ama.getByText(/says they paid you/).waitFor();
  await ama.evaluate(() => scrollTo(0, 0));
  const paid = ama.locator("section.needs-you li.ask", { hasText: "says they paid you" });
  await pointAt(ama, paid.getByRole("button", { name: "Yes, I got it" }));
  await freeze(ama, paid, "Settling takes both sides",
    "Kwesi says he paid. It only counts once Ama, the person who received the money, confirms it.");
  await click(ama, paid.getByRole("button", { name: "Yes, I got it" }));
  await ama.getByText("You're square").waitFor();
  cap("Everyone is square.");
  await sleep(3200);

  timeline.end = now();
  await cdp.send("Page.stopScreencast");
  await sleep(300);
  fs.writeFileSync(path.join(OUT, "timeline.json"), JSON.stringify(timeline, null, 1));
  await browser.close();
  console.log(`saved ${timeline.frames.length} frames, ${timeline.freezes.length} freezes, ${(timeline.end - timeline.start).toFixed(1)}s`);
})().catch((e) => { console.error(e); process.exit(1); });
