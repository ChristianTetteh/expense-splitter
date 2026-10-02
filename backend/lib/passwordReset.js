const crypto = require("crypto");

const RESET_MINUTES = 30;
const GENERIC_FORGOT_MESSAGE = `If that email has an account, a reset link is on its way. It works for ${RESET_MINUTES} minutes.`;
const INVALID_LINK_MESSAGE = "This reset link is invalid or has expired.";

const newResetToken = () => crypto.randomBytes(32).toString("base64url");
const hashResetToken = (token) => crypto.createHash("sha256").update(token).digest();

// The link always comes from the APP_ORIGIN setting, never from the request
// (Host / X-Forwarded-Host are attacker-controlled). The token sits in the URL
// fragment, which browsers never send to any server, so it can't land in
// access logs or Referer headers. Returns null when APP_ORIGIN is unusable.
function resetLink(token) {
  try {
    const url = new URL(process.env.APP_ORIGIN || "");
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return `${url.origin}/reset#${token}`;
  } catch {
    return null;
  }
}

function resetEmail({ displayName, link }) {
  const subject = "Reset your Tally password";
  const text = [
    `Hi ${displayName},`,
    "",
    "Someone asked to reset the password for your Tally account. To choose a new one, open this link:",
    "",
    link,
    "",
    `The link works once and expires in ${RESET_MINUTES} minutes.`,
    "",
    "If you didn't ask for this, ignore this email; your password hasn't changed.",
    "",
    "Tally",
  ].join("\n");

  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const html =
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#151A2D;max-width:520px">` +
    `<p>Hi ${esc(displayName)},</p>` +
    `<p>Someone asked to reset the password for your Tally account. To choose a new one, use the button below.</p>` +
    `<p><a href="${esc(link)}" style="display:inline-block;background:#1D3FBB;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:8px">Choose a new password</a></p>` +
    `<p>The link works once and expires in ${RESET_MINUTES} minutes. If the button doesn't work, copy this address into your browser:<br>` +
    `<span style="word-break:break-all">${esc(link)}</span></p>` +
    `<p>If you didn't ask for this, ignore this email; your password hasn't changed.</p>` +
    `<p>Tally</p></div>`;
  return { subject, text, html };
}

module.exports = { RESET_MINUTES, GENERIC_FORGOT_MESSAGE, INVALID_LINK_MESSAGE, newResetToken, hashResetToken, resetLink, resetEmail };
