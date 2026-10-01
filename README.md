# Tally — split a shared tab, settle up fast.

A full-stack expense-splitter built for the "Expense Splitter Web App" intern task:
**React + Node/Express + PostgreSQL**, deployed, tested, and built so the numbers are
guaranteed to add up — no floating-point drift, no rounding that leaves a cent unaccounted
for.

**Live demo:** _(added after deploy)_
**API:** _(added after deploy)_

## What's included

**Core requirements**
- **Add expenses with payer and amount** — pick who paid, what it was for, how much, and who
  it's split between (defaults to everyone in the tab)
- **Auto-calculate who owes whom** — a settlement view reduces every expense down to the
  smallest set of payments that would bring the group to zero (see [How settlement works](#how-settlement-works))
- **View expense history** — every expense on the tab, newest first, with who paid and how it
  was split

**Beyond the brief**
- **No account needed** — start a tab, share its link, no login anywhere. Fictional demo data
  only (see the note at the bottom on why).
- **Multiple, independent tabs** — not just one global expense pool; each tab has its own
  roster and its own link, so this reads like a real multi-group tool rather than a single
  demo dataset.
- **Uneven splits** — an expense doesn't have to involve the whole group; pick exactly who it's
  split between (e.g. a taxi only two of four people took)
- **Exact-cent math, never floating point** — every dollar amount is parsed into integer cents
  and all arithmetic (splitting, balances, settlement) happens in cents, so a $10 bill split
  three ways is always exactly 334 + 333 + 333 cents, not 333.33 repeating. See `lib/money.js`.
- **Add people after a tab's started** — a tab doesn't need its final roster locked in at
  creation
- **Remove a mistaken expense** — corrects the history and balances immediately
- **Rate limiting + security headers** — Helmet, and a rate limit on the two unauthenticated
  write paths (creating tabs, adding expenses) to blunt scripted abuse
- **Distinct visual identity** — a "paper tab / receipt" design (perforated edges, itemized
  mono-spaced line items, an ink-stamp settlement badge) rather than a generic dashboard
- **Mobile-tested**

```
expense-splitter/
  backend/     Express API + PostgreSQL (Node)
  frontend/    React app (Vite)
```

## How settlement works

Every expense is split into explicit per-person shares at the moment it's added (not
recomputed later), so each person's **net balance** is just:

```
net = (total they paid across all expenses) - (total of their shares across all expenses)
```

A positive balance means the group owes that person money; negative means they owe the
group. These always sum to exactly zero — every cent paid is someone's share of something, so
total paid equals total owed across the whole tab (`lib/settlement.js`, `computeBalances`).

From there, `computeSettlement` turns those balances into actual payments using a greedy
heuristic: repeatedly match whoever owes the most against whoever's owed the most, settle the
smaller of the two amounts, and repeat. This is the same approach tools like Splitwise use —
it's not the mathematically optimal minimum-transaction-count solution (that's an NP-hard
partition problem), but it never produces more than `(people with a nonzero balance) - 1`
payments, and for small groups it typically matches the optimum anyway.

Splitting itself also avoids floating-point rounding: `splitEvenly` in `lib/money.js` divides
a total in integer cents and hands out any leftover cents one at a time, so a split always sums
back to exactly the original amount.

## 1. Set up the database

```bash
cd backend
cp .env.example .env
# edit .env: set DATABASE_URL
npm install
npm run migrate   # creates groups, members, expenses, expense_participants (safe to re-run; idempotent)
```

## 2. Run the backend

```bash
cd backend
npm run dev        # http://localhost:4002
```

## 3. Run the frontend

```bash
cd frontend
cp .env.example .env   # VITE_API_URL, defaults to http://localhost:4002/api
npm install
npm run dev         # http://localhost:5173
```

Vite's dev server proxies `/api` to `http://localhost:4002` automatically, so the two `.env`
files only really matter once you deploy.

## Testing

```bash
cd backend
npm test
```

52 tests across money math, the settlement algorithm, input validation, and every API route
(mocked database, no live Postgres needed):

- `tests/money.test.js` — dollar parsing, formatting, and that `splitEvenly` always sums back
  to the original total, for 1–11 participants
- `tests/settlement.test.js` — balances always net to zero; settlement never exceeds
  `n - 1` transactions and always actually zeroes every balance when replayed
- `tests/validation.test.js` — group/member/expense input validation
- `tests/groups.test.js`, `tests/expenses.test.js` — every route, including the transactional
  group-creation and expense-creation paths (rollback on failure)

## API overview

| Method | Route | Description |
|--------|-------|-------------|
| POST   | `/api/groups` | Create a tab `{ name, members: [name, ...] }` (min 2 members) |
| GET    | `/api/groups/:id` | A tab + its members |
| POST   | `/api/groups/:id/members` | Add a person to an existing tab `{ name }` |
| POST   | `/api/groups/:id/expenses` | Add an expense `{ description, amount, payer_id, participant_ids? }` — `participant_ids` defaults to the whole group |
| GET    | `/api/groups/:id/expenses` | Expense history, newest first, with the split resolved to names |
| GET    | `/api/groups/:id/balances` | Each member's net balance, plus the settlement (who pays whom) |
| DELETE | `/api/expenses/:id` | Remove an expense |

`POST`/`DELETE` requests are rate-limited (60 requests / 15 min / IP).

## Deployment

Same shape as this project's sibling apps — a managed Postgres instance, a Render web service,
and a Vercel static frontend.

**Database:** [Supabase](https://supabase.com) (managed PostgreSQL), connected via the
**connection pooler** (`aws-0-<region>.pooler.supabase.com:6543`), not the direct host — the
direct host is IPv6-only and unreachable from Render's network.

**Backend — Render Web Service:**
1. New → Web Service → point at the repo, build/start commands `cd backend && npm install` /
   `cd backend && npm start`
2. Environment variables: `DATABASE_URL` (Supabase pooler string), `CORS_ORIGIN` (the deployed
   frontend's origin), `PGSSL=true`
3. `npm start` runs `node migrate.js && node server.js`, so the schema is applied on every boot
   (idempotent — safe to leave permanently)

**Frontend — Vercel:**
1. Import the repo → set the project's **Root Directory** to `frontend`
2. Environment variable: `VITE_API_URL` = `https://<your-backend>.onrender.com/api`
3. `frontend/vercel.json` adds the SPA rewrite so a direct visit to `/groups/:id` doesn't 404

## Notes for extending it

- There's no notion of accounts, so a tab's link is its access control — anyone with the link
  can add expenses or add people to it. That's an intentional simplification for a no-login
  demo, not something to carry into a real product without adding real access control.
- Splits are currently either "everyone" or "an explicit subset, split evenly." Uneven custom
  splits (e.g. "Ama owes more because she had the lobster") aren't supported — `amount_cents`
  on `expense_participants` is already a per-person value, so that would extend the same schema
  rather than requiring a new one.
- No currency support beyond a single implicit currency — multi-currency would need a currency
  column on `expenses` and a conversion step before balances could be computed across them.
