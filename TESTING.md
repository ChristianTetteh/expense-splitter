# Testing and security review

Tally handles money between people, so the tests focus on two promises:

1. **Privacy:** two unrelated people never see each other's tabs.
2. **Billing:** nobody can make another person's balance worse without that person's OK, and nobody can leave a tab owing money or with something unresolved.

Three kinds of evidence back this up: automated backend tests, a browser end-to-end run, and two independent security reviews.

## 1. Backend tests (97)

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
| `money.test.js`, `settlement.test.js`, `validation.test.js` | Cent-exact splitting, who-owes-whom settlement, input validation, look-alike and invisible-character names |

## 2. Browser end-to-end run (20 checks)

`e2e/run.js` drives a real browser with three separate users (Ama, Kwesi and a stranger), each in their own browser session. It serves pages with the production Content-Security-Policy, so a CSP violation shows up as a failure.

```bash
# start the backend and frontend locally (see README), then:
cd e2e && npm install && npx playwright install chromium   # or point to an installed Chromium
node run.js
```

What it checks: logged-out redirect; open-redirect attempt through `?next=`; session cookie hidden from page scripts; invite link flow; a non-member opening a tab URL sees "Tab not found."; a requester can't see the tab before approval; the owner sees the requester's email; a new charge is pending until accepted; accepting makes the debt count on both sides; a fake expense doesn't touch the other person's debt; a decline stays visible and the debt stands; a debtor gets no "void" button on someone else's expense; a payment claim stays pending until the receiver confirms; an open dispute blocks leaving; after leaving, the tab is gone; no console errors.

Last result: **20 / 20 pass.**

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

## 4. Known limits

These are deliberate and also listed in the README.

- A determined debtor can dispute a charge and stay in the tab, but it is visible and attributed to them, and it blocks them from leaving too.
- A new-network lockout still needs an attacker with 13 or more addresses, and only affects logins from *new* places.
- No email verification or password reset (needs an email-sending service).
- Checks that run only on the live site are limited to headers, direct-access refusal, status codes and CSP. The full two-user money flow was tested locally, not on the live site.
