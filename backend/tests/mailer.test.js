// fetch is stubbed throughout: nothing here ever reaches a real mail service.
const fs = require("fs");
const os = require("os");
const path = require("path");

const KEY = "xkeysib-super-secret-test-key";
const msg = { to: "ama@test.dev", subject: "Hello", text: "Plain body https://x.test/reset#tok", html: "<p>Hi</p>" };

let logs;
beforeEach(() => {
  jest.resetModules();
  delete process.env.MAIL_OUTBOX_FILE;
  process.env.BREVO_API_KEY = KEY;
  process.env.MAIL_FROM = "noreply@tally.test";
  process.env.MAIL_FROM_NAME = "Tally";
  global.fetch = jest.fn(async () => ({ ok: true, status: 201 }));
  logs = [];
  for (const m of ["log", "warn", "error"]) jest.spyOn(console, m).mockImplementation((...a) => logs.push(a.join(" ")));
});
afterEach(() => jest.restoreAllMocks());
const load = () => require("../lib/mailer");

it("posts the Brevo payload with the api-key header and a timeout", async () => {
  const { sendMail, isConfigured } = load();
  expect(isConfigured()).toBe(true);
  expect(await sendMail(msg)).toEqual({ sent: true });
  const [url, opts] = global.fetch.mock.calls[0];
  expect(url).toBe("https://api.brevo.com/v3/smtp/email");
  expect(opts.method).toBe("POST");
  expect(opts.headers["api-key"]).toBe(KEY);
  expect(opts.signal).toBeInstanceOf(AbortSignal);
  expect(JSON.parse(opts.body)).toEqual({
    sender: { name: "Tally", email: "noreply@tally.test" },
    to: [{ email: "ama@test.dev" }],
    subject: "Hello",
    textContent: msg.text,
    htmlContent: "<p>Hi</p>",
  });
});

it("never throws and never logs the key, whether Brevo refuses or the network fails", async () => {
  const { sendMail } = load();
  global.fetch.mockResolvedValueOnce({ ok: false, status: 401 });
  expect(await sendMail(msg)).toEqual({ sent: false });
  global.fetch.mockRejectedValueOnce(Object.assign(new Error(`boom ${"x"}`), { name: "TypeError" }));
  expect(await sendMail(msg)).toEqual({ sent: false });
  global.fetch.mockRejectedValueOnce(Object.assign(new Error("The operation timed out"), { name: "TimeoutError" }));
  expect(await sendMail(msg)).toEqual({ sent: false });
  expect(logs.join("\n")).not.toContain(KEY);
  expect(logs.length).toBe(3);
});

it("without a key, in development, prints the message (with its link) and sends nothing", async () => {
  delete process.env.BREVO_API_KEY;
  const { sendMail, isConfigured } = load();
  expect(isConfigured()).toBe(false);
  await sendMail(msg);
  expect(global.fetch).not.toHaveBeenCalled();
  expect(logs.join("\n")).toContain("https://x.test/reset#tok");
});

it("without a key, in production, warns and sends nothing — and does not print the link", async () => {
  delete process.env.BREVO_API_KEY;
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const { sendMail } = load();
    expect(await sendMail(msg)).toEqual({ sent: false });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(logs.join("\n")).toMatch(/NOT sent/);
    expect(logs.join("\n")).not.toContain("#tok");
  } finally {
    process.env.NODE_ENV = prev;
  }
});

it("MAIL_OUTBOX_FILE appends JSON lines outside production, and is ignored in production", async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "outbox-")), "mail.jsonl");
  process.env.MAIL_OUTBOX_FILE = file;
  let { sendMail } = load();
  await sendMail(msg);
  expect(global.fetch).not.toHaveBeenCalled();
  expect(JSON.parse(fs.readFileSync(file, "utf8").trim()).text).toBe(msg.text);

  jest.resetModules();
  process.env.NODE_ENV = "production";
  try {
    ({ sendMail } = load());
    await sendMail(msg);
    expect(global.fetch).toHaveBeenCalledTimes(1); // real provider path, outbox ignored
    expect(fs.readFileSync(file, "utf8").trim().split("\n")).toHaveLength(1);
  } finally {
    process.env.NODE_ENV = "test";
  }
});
