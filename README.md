# Tally — split a shared tab, settle up fast.

A full-stack expense splitter built for the "Expense Splitter Web App" intern task:
**React + Node/Express + PostgreSQL**, deployed and tested. Each tab is private to the people in
it, nobody can log a payment in someone else's name, and the money rules are built so that nobody
can get out of what they owe.

**Live demo:** https://tally-splitter.vercel.app

_The API runs on a free Render instance, so the first request after a quiet period can take
~30–60 seconds while it wakes up._

## What's included

**Core requirements**
- **Add expenses with payer and amount.** You record what you paid, how much, and who it's split
  between.
- **Auto-calculate who owes whom.** A settle-up view reduces every expense and repayment to the
  smallest set of payments that would bring the tab to zero (see
  [How settlement works](#how-settlement-works)).
- **View expense history.** Every expense and every repayment, including voided ones, which stay
  visible and are marked with who voided them and when.

**Beyond the brief**
- **Accounts and private tabs.** Email + password sign-in. A tab is visible only to its current
  members.
- **Invite-and-approve.** The owner shares an invite link. Anyone with it can *ask* to join, and
  the owner approves each person, seeing their name and email.
- **Nothing changes what you owe without your OK.** Each share of an expense counts only once
  that person accepts it. "I paid Ama" stays pending until Ama confirms she received it.
- **Disputes, not escapes.** Declining a charge opens a dispute everyone can see, and neither
  side can leave the tab until one of them gives way.
- **Exact-cent math, never floating point.** All arithmetic is in integer cents, so $10 split
  three ways is exactly 334 + 333 + 333.
- **Uneven splits.** An expense can involve any subset of the tab.

```
expense-splitter/
  backend/     Express API + PostgreSQL (Node)
  frontend/    React app (Vite)
```

## Security model

The two questions this is built to answer: **who can see a tab**, and **can anyone dodge what
they owe**.

### Who can see what

| Who | What they can see |
|---|---|
| Not logged in | Nothing. Every tab and invite endpoint needs a session. |
| Logged in, not in the tab | Nothing. Every tab route answers with the same `404 Tab not found.` whether the tab exists or not, so tab ids can't be probed. Tab ids are random UUIDs, not counters. |
| Holding an invite link | The tab's name, its owner's name and the member count, nothing else, until the owner approves them. |
| Member | The whole tab: people, expenses, repayments, balances. |
| Owner | All of the above, plus the invite link and pending join requests. |
| Former member (left / removed) | Nothing any more. |

`GET /api/groups` only returns tabs you're currently in. There is no endpoint that lists anyone
else's tabs.

### Rules that stop people avoiding a bill

One principle runs through all of them: **nothing can make your balance worse without your OK**,
and **nobody can leave with anything unresolved**.

| Attempt | What happens |
|---|---|
| Record an expense as if someone else paid it | Impossible. The payer is always the logged-in user; any payer field in the request is ignored. |
| Cancel your debt with a fake expense charged to your creditor ("I paid $20, split with Ama") | The charge is `pending` and changes nothing until Ama accepts it. If she declines, the debt stands and the dispute is on the record. |
| Shift your debt onto a third person with a fake charge | Same: it doesn't count unless they accept. |
| Decline a genuine bill, then leave | `409`. A declined share is an **open dispute**. Neither the payer nor the decliner can leave, and the owner can't remove them, until the decliner accepts after all or the payer withdraws the charge. |
| Delete or void an expense you owe on | `403`. Only the person who paid can void an expense, and voiding never deletes it: it stays in the history, marked "voided by X". |
| Claim "I paid them" to clear your debt | The claim is `pending` and changes nothing until the **receiver** confirms. You can't confirm your own claim. |
| Confirm or decline someone else's payment | `403`. Only the receiver can confirm or decline. A pending claim can only be withdrawn by the person who made it. |
| Re-open a settled debt by undoing a confirmed payment | The receiver gets 15 minutes to fix a typo. After that, only the **payer** can undo it, which only raises their own debt. |
| Leave the tab while you owe money | `409`. You (or the owner removing you) can only leave at a zero balance with nothing pending. |
| Leave, then have an old expense voided so the debt re-opens | `409`. Expenses and payments involving someone who has left are locked. |
| Race a "leave" against a new bill | The tab is row-locked for every money-moving write, so one of them fails cleanly. This is covered by a concurrency test. |
| Point an expense at someone from a different tab | Rejected by the API, and independently by the database: every member reference is a composite `(tab, member)` foreign key. |
| Pick the display name "you" (or "yоu" with a Cyrillic о, or fullwidth "ｙｏｕ") so others see "Kwesi owes you" | Rejected. Names are NFKC-folded, can't mix Latin with look-alike alphabets, and can't use the words or symbols the UI uses for itself. |

### Accounts and sessions

- Passwords are hashed with **scrypt** (memory-hard, per-user salt). Login gives the same answer,
  with the same work, for an unknown email and a wrong password.
- Sessions are random 256-bit tokens in an **HttpOnly, SameSite=Lax, Secure, `__Host-`** cookie.
  Only a SHA-256 hash is stored in the database. Logging out deletes the session on the server.
  Sessions expire after 14 days.
- **Brute force:** 8 failed logins per (account, address) per 15 minutes, plus a ceiling of 100
  per account per hour across all addresses. Addresses you've already signed in from (kept only as
  a keyed hash) are exempt from that ceiling, so a stranger hammering your email can't lock you out
  of your usual connection. There's also a per-account limit on writes.

### Request forgery, XSS and the rest

- **The API only answers through the frontend's proxy.** Vercel Routing Middleware
  (`frontend/middleware.js`) forwards `/api/*` to the backend with a shared secret and the
  visitor's real IP, taken from Vercel's own connection data. The backend refuses anything without
  the secret, so calling the onrender.com URL directly gets `403`. `X-Forwarded-For` is never
  trusted, so nobody can fake their address to get around rate limits.
- The browser only ever talks to one origin, and the API sends **no CORS headers at all**, so
  other sites' scripts can't read its responses.
- Every write must be `application/json`, must not be a cross-site fetch (`Sec-Fetch-Site`), and
  must come from the app's own `Origin`. This is on top of SameSite cookies.
- A strict **Content-Security-Policy** (`script-src 'self'`, `frame-ancestors 'none'`, …),
  `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` (so invite links never leak in
  headers), and HSTS. All API responses are `Cache-Control: no-store`.
- React escapes everything it renders, and there's no `dangerouslySetInnerHTML` anywhere. All
  SQL is parameterised. Text input is stripped of control characters and Unicode bidi overrides
  (which can make a description *display* as something other than what it says).
- Login only redirects to a path on this site (`?next=` rejects `//host`, `/\host` and absolute
  URLs). `react-router` is on a version patched for the related open-redirect advisory.
- Body size is capped at 10 KB. Limits apply to tab size, tabs per person, pending requests and
  pending payments.
- `npm audit`: 0 known vulnerabilities in either the backend or the frontend.

### Known limits (honest list)

- **No email verification.** There's no email service, so an address isn't proven to belong to
  whoever signed up with it. That's why owners see each requester's email and approve them
  personally, and why an invite link only lets someone *ask*. It also means there's no "forgot
  password" reset.
- **Software can't make anyone hand over money.** A determined debtor can dispute a real charge
  and refuse to budge. What Tally guarantees is that they can't do it quietly or walk away from it:
  the dispute is visible to everyone, attributed, and keeps them in the tab until it's resolved.
  (The flip side: two people who never resolve a dispute both stay in that tab.)
- **Someone signing in from a brand-new network** can still be slowed by a sustained attack on
  their email from 13+ addresses (the per-account ceiling). Known networks are unaffected.

## How settlement works

Every expense is split into explicit per-person shares the moment it's added, so each person's
**net balance** is:

```
net = (accepted shares of expenses they paid) − (their own accepted shares)
    + (repayments they sent) − (repayments they received)
```

Only accepted shares of expenses that haven't been voided count, and only repayments the receiver
has confirmed. Pending, declined and withdrawn shares move nothing.
Positive means the tab owes you; negative means you owe. Balances always sum to exactly zero.

`computeSettlement` then repeatedly matches whoever owes the most against whoever is owed the
most, the same greedy approach Splitwise uses. That never takes more than
`(people with a nonzero balance) − 1` payments.

## Running it locally

```bash
# database
createdb tally_dev

# backend
cd backend
cp .env.example .env     # set DATABASE_URL
npm install
npm run migrate          # versioned migrations, each applied once
npm run dev              # http://localhost:4002

# frontend (separate terminal)
cd frontend
npm install
npm run dev              # http://localhost:5173 — proxies /api to :4002
```

## Testing

See [TESTING.md](TESTING.md) for the full write-up (tests, browser run, security review findings and fixes).

```bash
createdb tally_test
cd backend
npm test
```

97 tests. The security tests run against a **real Postgres database** (not mocks), so they exercise
the actual queries, locks and constraints:

- `tests/auth.test.js`: hashing, cookie flags, hashed session storage, logout revocation,
  expiry, identical login errors, CSRF (form posts, foreign `Origin`, cross-site fetches), no
  CORS, headers, oversized and malformed bodies
- `tests/isolation.test.js`: outsiders get identical 404s on every route, can't reach
  expenses through another tab, the database rejects cross-tab references, invite links only let
  people ask, owner-only controls, link rotation, duplicate-name labelling, injection payloads
  stored literally
- `tests/billing.test.js`: payer can't be spoofed; charges count only once accepted; the
  fake-expense, debt-shifting and decline-then-leave attacks (regression tests); disputes and
  withdrawals; only the payer voids; payment claims need the receiver; the undo grace period;
  leaving needs a zero balance and nothing open; departed members can't be re-billed; the
  leave-vs-bill race
- `tests/rateLimits.test.js`: requests without the proxy secret are refused; `X-Forwarded-For`
  can't be used to dodge limits; known addresses can't be locked out; distributed guessing is capped
- `tests/money.test.js`, `tests/settlement.test.js`, `tests/validation.test.js`: the pure logic

The full browser flow was also run end-to-end (20 checks) in headless Chromium with the
production CSP applied: invite → approve → accept a charge → fake-expense attempt declined →
payment claim → confirm → dispute blocks leaving → withdraw → leave. The security design was
reviewed twice by an independent reviewer; every finding is fixed and covered by a test.

## API overview

All routes except `/api/auth/*` and `/api/health` need a session. All writes are JSON `POST`s.

| Route | Who | What |
|---|---|---|
| `POST /api/auth/signup` · `login` · `logout`, `GET /api/auth/me` | anyone | Accounts and sessions |
| `GET /api/groups` | you | Tabs you're in, with your balance in each |
| `POST /api/groups` | you | Start a tab `{ name }` |
| `GET /api/groups/:id` | member | The whole tab: people, expenses, payments, balances, settlement |
| `POST /api/groups/:id/expenses` | member | Add something **you** paid `{ description, amount, participant_ids }` |
| `POST /api/groups/:id/expenses/:eid/{accept,decline}` | that participant | Answer for your share |
| `POST /api/groups/:id/expenses/:eid/shares/:mid/withdraw` | the payer | Drop a pending or disputed charge |
| `POST /api/groups/:id/expenses/:eid/void` | the payer | Void (never delete) an expense |
| `POST /api/groups/:id/payments` | member | `{ direction: "sent" \| "received", counterparty_id, amount }` |
| `POST /api/groups/:id/payments/:pid/{confirm,decline}` | the receiver | Resolve a payment |
| `POST /api/groups/:id/payments/:pid/void` | the payer (or receiver within 15 min) | Undo a confirmed payment |
| `POST /api/groups/:id/payments/:pid/cancel` | whoever recorded it | Withdraw a pending claim |
| `POST /api/groups/:id/leave` | member (not owner), when square | Leave |
| `POST /api/groups/:id/members/:mid/remove` | owner, target square | Remove someone |
| `POST /api/groups/:id/invite/{regenerate,disable}` | owner | Manage the invite link |
| `POST /api/groups/:id/requests/:uid/{approve,decline}` | owner | Decide on a join request |
| `GET /api/invites/:token`, `POST /api/invites/:token/request` | you | Preview a tab / ask to join |

## Deployment

**Database:** Render Postgres. Migrations run on every boot (`npm start`), each applied once and
tracked in `schema_migrations`, behind an advisory lock. Free Render Postgres instances expire
after 30 days unless upgraded.

**Backend:** a Render web service with build `cd backend && npm install` and start
`cd backend && npm start`. Environment variables:
- `DATABASE_URL`: the Internal Database URL
- `PGSSL=false`: internal network
- `NODE_ENV=production`: turns on `Secure` / `__Host-` cookies
- `APP_ORIGIN=https://<your-frontend>`
- `PROXY_SECRET`: a long random string shared with the frontend
- The server refuses to start in production without `APP_ORIGIN` and `PROXY_SECRET`.

**Frontend:** Vercel with root directory `frontend`. Environment variables: `BACKEND_ORIGIN`
(e.g. `https://<your-backend>.onrender.com`) and the same `PROXY_SECRET`. `frontend/middleware.js`
proxies `/api/*`. `frontend/vercel.json` adds the SPA fallback and the security headers.
