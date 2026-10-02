const fs = require("fs");

// Sends one transactional email through Brevo's REST API (built-in fetch, no
// SDK). It never throws and never logs the API key: a mail problem must not
// break the request that triggered it, and the caller can't act on it anyway.
//
//   BREVO_API_KEY   provider key. Unset = nothing is sent (see below).
//   MAIL_FROM       sender address (must be a sender verified in Brevo)
//   MAIL_FROM_NAME  sender display name (default "Tally")
//   MAIL_OUTBOX_FILE  development/test only: append each message as a JSON
//                   line to this file instead of sending. Ignored in production.

const BREVO_URL = "https://api.brevo.com/v3/smtp/email";
const TIMEOUT_MS = 10_000;

const isProduction = () => process.env.NODE_ENV === "production";
const isConfigured = () => Boolean(process.env.BREVO_API_KEY && process.env.MAIL_FROM);

async function sendMail({ to, subject, text, html }) {
  try {
    if (!isProduction() && process.env.MAIL_OUTBOX_FILE) {
      fs.appendFileSync(process.env.MAIL_OUTBOX_FILE, JSON.stringify({ to, subject, text, html, at: new Date().toISOString() }) + "\n");
      return { sent: false, outbox: true };
    }

    if (!isConfigured()) {
      if (isProduction()) {
        // The body is deliberately not logged here: it contains a live reset link.
        console.warn("[mailer] BREVO_API_KEY / MAIL_FROM are not set; an email was NOT sent.");
      } else {
        console.log(`[mailer] (dev, not sent) To: ${to}\nSubject: ${subject}\n\n${text}\n`);
      }
      return { sent: false };
    }

    const res = await fetch(BREVO_URL, {
      method: "POST",
      headers: { "api-key": process.env.BREVO_API_KEY, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        sender: { name: process.env.MAIL_FROM_NAME || "Tally", email: process.env.MAIL_FROM },
        to: [{ email: to }],
        subject,
        textContent: text,
        ...(html ? { htmlContent: html } : {}),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error(`[mailer] Brevo refused the message (HTTP ${res.status}).`);
      return { sent: false };
    }
    return { sent: true };
  } catch (err) {
    // err.message can't contain the key (it's only ever in a header).
    console.error(`[mailer] sending failed: ${err && err.name === "TimeoutError" ? "timed out" : err && err.message}`);
    return { sent: false };
  }
}

module.exports = { sendMail, isConfigured };
