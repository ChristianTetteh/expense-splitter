-- 001: accounts, membership-gated tabs, auditable money records.
--
-- Replaces the original no-login demo schema. Those tables only ever held
-- throwaway demo data, so they're dropped rather than migrated.
DROP TABLE IF EXISTS expense_participants CASCADE;
DROP TABLE IF EXISTS expenses CASCADE;
DROP TABLE IF EXISTS members CASCADE;
DROP TABLE IF EXISTS groups CASCADE;

-- ── Accounts ────────────────────────────────────────────────────────────

CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL CHECK (char_length(email) BETWEEN 3 AND 254),
  display_name  TEXT NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 50),
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));

-- Only a SHA-256 hash of each session token is stored, so a leaked copy of
-- this table can't be replayed as a logged-in session.
CREATE TABLE sessions (
  token_hash  BYTEA PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expiry_idx ON sessions (expires_at);

-- Network addresses (keyed, hashed) each account has successfully signed in
-- from. Lets the per-account failed-login limit skip a user's own known
-- connections, so a stranger hammering your email can't lock YOU out.
CREATE TABLE login_addresses (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  addr_hash  BYTEA NOT NULL,
  last_seen  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, addr_hash)
);

-- ── Tabs and who's in them ─────────────────────────────────────────────

-- Random UUIDs, not sequential ids: a tab's id reveals nothing about how
-- many tabs exist. (Access is enforced by membership regardless.)
CREATE TABLE groups (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 80),
  owner_id      INTEGER NOT NULL REFERENCES users(id),
  invite_token  TEXT UNIQUE,            -- NULL = invite link switched off
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A member row is never deleted once created — leaving sets left_at — so
-- every historical expense and payment keeps pointing at a real person.
CREATE TABLE members (
  id         SERIAL PRIMARY KEY,
  group_id   UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  left_at    TIMESTAMPTZ,
  UNIQUE (group_id, user_id),
  UNIQUE (group_id, id)                 -- target for the composite FKs below
);
CREATE INDEX members_user_idx ON members (user_id) WHERE left_at IS NULL;

-- Someone with the invite link asks to join; the tab's owner decides.
CREATE TABLE join_requests (
  group_id      UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requested_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);

-- ── Money ───────────────────────────────────────────────────────────────
-- Every member reference below is a composite (group_id, member_id) FK, so
-- the database itself refuses an expense or payment that points at someone
-- from a different tab, whatever the application code does.

CREATE TABLE expenses (
  id                   SERIAL PRIMARY KEY,
  group_id             UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  payer_member_id      INTEGER NOT NULL,
  description          TEXT NOT NULL CHECK (char_length(description) BETWEEN 1 AND 200),
  amount_cents         INTEGER NOT NULL CHECK (amount_cents > 0 AND amount_cents <= 100000000),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  voided_at            TIMESTAMPTZ,
  voided_by_member_id  INTEGER,
  UNIQUE (group_id, id),
  FOREIGN KEY (group_id, payer_member_id) REFERENCES members (group_id, id),
  FOREIGN KEY (group_id, voided_by_member_id) REFERENCES members (group_id, id),
  CHECK ((voided_at IS NULL) = (voided_by_member_id IS NULL))
);
CREATE INDEX expenses_group_idx ON expenses (group_id, created_at DESC);

-- One row per person an expense is split with. The core money rule of the
-- app is that NOTHING CAN MAKE YOUR BALANCE WORSE WITHOUT YOUR OK, so a
-- share charged to anyone other than the payer starts 'pending' and only
-- counts once that person accepts it. (Without this, someone who owes $20
-- could log a fake $20 "expense" charged to their creditor and cancel the
-- debt.) The payer's own share is 'accepted' from the start.
--
-- 'declined' is an OPEN DISPUTE, not an exit: it doesn't count, but while
-- it's open neither the payer nor the person who declined can leave the tab.
-- It closes only when one side gives way — the participant accepts after all,
-- or the payer withdraws the charge ('withdrawn').
CREATE TABLE expense_shares (
  expense_id    INTEGER NOT NULL,
  group_id      UUID NOT NULL,
  member_id     INTEGER NOT NULL,
  share_cents   INTEGER NOT NULL CHECK (share_cents > 0),
  status        TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'declined', 'withdrawn')),
  responded_at  TIMESTAMPTZ,
  PRIMARY KEY (expense_id, member_id),
  FOREIGN KEY (group_id, expense_id) REFERENCES expenses (group_id, id) ON DELETE CASCADE,
  FOREIGN KEY (group_id, member_id) REFERENCES members (group_id, id)
);
CREATE INDEX expense_shares_group_idx ON expense_shares (group_id);
CREATE INDEX expense_shares_open_idx ON expense_shares (group_id, member_id) WHERE status IN ('pending', 'declined');

-- A repayment between two members. Same rule: it lowers the receiver's
-- balance, so it only counts once the RECEIVER has recorded or confirmed it —
-- nobody can clear their own debt by simply claiming they paid. Undoing a
-- confirmed payment raises the payer's debt again, so after a short grace
-- period for typos only the payer can do that.
CREATE TABLE payments (
  id                     SERIAL PRIMARY KEY,
  group_id               UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  from_member_id         INTEGER NOT NULL,     -- who handed money over
  to_member_id           INTEGER NOT NULL,     -- who received it
  amount_cents           INTEGER NOT NULL CHECK (amount_cents > 0 AND amount_cents <= 100000000),
  recorded_by_member_id  INTEGER NOT NULL,
  status                 TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'declined', 'voided')),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at            TIMESTAMPTZ,
  resolved_by_member_id  INTEGER,
  FOREIGN KEY (group_id, from_member_id) REFERENCES members (group_id, id),
  FOREIGN KEY (group_id, to_member_id) REFERENCES members (group_id, id),
  FOREIGN KEY (group_id, recorded_by_member_id) REFERENCES members (group_id, id),
  FOREIGN KEY (group_id, resolved_by_member_id) REFERENCES members (group_id, id),
  CHECK (from_member_id <> to_member_id),
  CHECK (recorded_by_member_id IN (from_member_id, to_member_id))
);
CREATE INDEX payments_group_idx ON payments (group_id, created_at DESC);
