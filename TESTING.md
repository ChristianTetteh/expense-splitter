# Testing and security review

Tally handles money between people, so the tests focus on two promises:

1. **Privacy:** two unrelated people never see each other's tabs.
2. **Billing:** nobody can make another person's balance worse without that person's OK, and nobody can leave a tab owing money or with something unresolved.

Three kinds of evidence back this up: automated backend tests, a browser end-to-end run, and two independent security reviews.

## 1. Backend tests (131)

They run against a real PostgreSQL database, not mocks, so they exercise the real queries, locks and constraints.

```bash
createdb tally_test
# default connection is the local socket; for another server set TEST_DATABASE_URL=postgresql://user:pass@host:5432/tally_test
cd backend
npm install
npm test        # jest --runInBand
```

| File | What it proves |
|---|---|
| `auth.test.js` | Password hashing, cookie flags, sessions stored hashed, logout revokes the session, expiry, identical login errors, CSRF protection, no CORS, security headers, oversized/malformed bodies |
| `isolation.test.js` | Outsiders get identical 404s on every route, can't reach expenses through another tab, the database refuses cross-tab references, invite links only let people *ask*, owner-only controls, injection payloads stored literally |
| `billing.test.js` | Payer can't be spoofed; charges count only once accepted; fake-expense, debt-shifting and decline-then-leave attacks (regression tests); disputes; only the payer voids; payment claims need the receiver; undo window; leave needs zero balance; leave-vs-bill race |
| `rateLimits.test.js` | Requests without the proxy secret are refused; `X-Forwarded-For` can't dodge limits; known addresses can't be locked out; distributed guessing is capped |
| `passwordReset.test.js` | Password reset, with the mailer mocked and the proxy and limiters switched on: `forgot` answers identically for known, unknown and malformed emails (status, body, headers); mail goes only to real accounts; the link host comes from `APP_ORIGIN` even with forged `Host` / `X-Forwarded-Host`; the token is stored only as a SHA-256 and never appears in the table; 30-minute expiry (faked in SQL); single use; a second request retires the first link; two simultaneous requests leave one live link; the password changes, the old one stops working, all sessions are revoked and the user is not logged in; weak or email-equal passwords are refused and the link stays usable; garbage tokens get a 400; three simultaneous submits give exactly one success; silent per-address and per-email limits (no 429, nothing sent) and the 429 limit on `reset`; the CSRF guard applies |
| `mailer.test.js` | Brevo request shape (URL, `api-key` header, JSON body, timeout signal); never throws or logs the key; development prints, production only warns (and doesn't print the link); the outbox file works outside production only. `fetch` is stubbed: nothing reaches a mail service |
| `money.test.js`, `settlement.test.js`, `validation.test.js` | Cent-exact splitting, who-owes-whom settlement, input validation, look-alike and invisible-character names |

## 2. Browser end-to-end run (34 checks)

`e2e/run.js` drives a real browser with three separate users (Ama, Kwesi and a stranger), each in their own browser session. It serves pages with the production Content-Security-Policy, so a CSP violation shows up as a failure.

```bash
# start the backend and frontend locally (see README), then:
cd e2e && npm install && npx playwright install chromium   # or point to an installed Chromium
node run.js
```

What it checks: logged-out redirect; open-redirect attempt through `?next=`; session cookie hidden from page scripts; invite link flow; a non-member opening a tab URL sees "Tab not found."; a requester can't see the tab before approval; the owner sees the requester's email; a new charge is pending until accepted; accepting makes the debt count on both sides; a fake expense doesn't touch the other person's debt; a decline stays visible and the debt stands; a debtor gets no "void" button on someone else's expense; a payment claim stays pending until the receiver confirms; an open dispute blocks leaving; after leaving, the tab is gone; a new tab is in Ghana cedis (GH₵) and a tab made in US dollars shows $ amounts; no console errors.

The run finishes with the password-reset flow. The backend is started with `MAIL_OUTBOX_FILE` (honoured only outside production), which makes it append each email to a file instead of sending it; the script reads the link from there. It checks: the same confirmation for a real and an unknown email; no mail for the unknown one; the link points at the app origin with the token in the `#fragment`; the token is stripped from the address bar and never appears in any request URL; mismatched and too-short passwords are refused; success lands on `/login` with a notice; the old password fails and the new one works; Ama's other two sessions are logged out; a used link and a bare `/reset` both show "Request a new link"; no sideways scroll at 390px. Start the backend with `MAIL_OUTBOX_FILE=/tmp/claude-0/outbox.jsonl` (or set the same variable when running `run.js`).

Last result: **33 / 33 pass.**

## 3. Independent security reviews

A separate reviewer, who hadn't seen the code being written, attacked the app twice. Proof-of-exploit scripts are in `e2e/review-proofs/`. Run them from `backend/` (e.g. `node ../e2e/review-proofs/exploit1.js`); they print what the attack now achieves.

### Round 1: findings and fixes

| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | Critical | A debtor could post a fake expense (paid by them, split only with the creditor) that cancels their debt, then leave. It could also shift debt onto a newcomer. | Charges to others are *pending* until that person accepts, and only accepted shares count. Leaving is blocked while anything is pending. |
| 2 | Medium | A creditor could void a payment they'd already confirmed, re-billing the debtor. | The receiver can undo only within 15 minutes; after that only the payer can, and that only raises their own debt. |
| 3 | Medium | Rate limits could be dodged with a forged `X-Forwarded-For`; accounts could be locked out by anyone; the server's direct address bypassed the website. | Server only accepts requests carrying a shared secret added by the website's proxy; client IP comes from the proxy, never from client headers; limits keyed on email + address. |
| 4 | Low-Med | A member named "you" could make screens read "Kwesi owes you". | Reserved names, plus a ban on `()★☆*<>`. |
| 5-10 | Low | Trapped members, wrong "split evenly" label, silent rounding, leftover unauthenticated delete route, unbounded payment history, tab-lock timing signal. | All fixed (same-root-cause for #5; strings-only amounts; route deleted; history capped; membership checked before locking). |

### Round 2: findings and fixes

| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | High | Declining a charge and then leaving was a legal way to avoid being billed. | A decline opens a **dispute**. It blocks both people from leaving (and blocks removal) until the decliner accepts or the payer withdraws the charge. |
| 2 | Medium | Account lockout from many addresses. | Addresses a user has logged in from before are exempt from the per-account limit. What remains is below. |
| 3 | Low-Med | Look-alike letters (Cyrillic "о" in "you") got past the reserved-name check. | Names can't mix alphabets; Unicode folding applied. |
| 4 | Low | Totals showed money that didn't count. | Totals show only accepted amounts; the rest is labelled pending or declined. |
| 5 | Low | The receiver can undo a payment for 15 minutes. | Kept on purpose, and visible in history; the payer can re-record. |
| 6 | Low | The proxy forwarded every header. | Checked on the live deployment. |

## 4. Password reset review

Attacker-minded pass over the reset feature (every item is covered by a test unless noted).

| Question | Answer |
|---|---|
| Does the token leak through `Referer`, logs or history? | It's in the URL fragment, never sent to any server; `Referrer-Policy: no-referrer` (header and meta tag); the page removes it with `history.replaceState`; the API receives it in a POST body. The production mailer never logs message bodies. |
| Host-header poisoning? | The link uses `APP_ORIGIN` only (tested with forged `Host`, `X-Forwarded-Host`, `Forwarded`). |
| Account enumeration by status, body, headers, timing, or rate limit? | One answer for every case. The lookup, token insert and mail all happen after the response. Rate-limited requests also get the same 200, without `RateLimit-*` headers from the forgot limiters. |
| Token brute force? | 256-bit random token, SHA-256 lookup, 10 attempts per address per 15 minutes. |
| Session fixation / stolen sessions? | A reset deletes every session and sets no new one; login always issues a fresh token. |
| Reuse and races? | Single use; row locked `FOR UPDATE`; concurrent forgot requests are serialised on the user row (found in review: two simultaneous requests could leave two live links; fixed and tested). |
| CSRF? | Same guard as all writes (JSON only, `Sec-Fetch-Site`, `Origin`). |
| Not covered by code | Click tracking in the mail provider could route the link through a third party: turn it off in Brevo. |

## 5. Known limits

These are deliberate and also listed in the README.

- A determined debtor can dispute a charge and stay in the tab, but it is visible and attributed to them, and it blocks them from leaving too.
- A new-network lockout still needs an attacker with 13 or more addresses, and only affects logins from *new* places.
- No email verification at signup. Password reset works only when the mail provider (`BREVO_API_KEY`, `MAIL_FROM`) is configured; without it no email is sent.
- Anyone who knows an address can use up its 3 reset emails an hour. This delays that person's reset email; it reveals nothing and changes nothing.
- Checks that run only on the live site are limited to headers, direct-access refusal, status codes and CSP. The full two-user money flow was tested locally, not on the live site.
