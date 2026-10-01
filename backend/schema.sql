-- Expense Splitter schema. Safe to re-run (idempotent).
--
-- Money is stored as integer cents everywhere (amount_cents, share_cents),
-- never as floating point or even NUMERIC-with-division, so splitting
-- $10.00 three ways is always exactly 334 + 333 + 333 cents — no rounding
-- drift that could ever make a group's books fail to balance to zero.

CREATE TABLE IF NOT EXISTS groups (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS members (
  id SERIAL PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_members_group ON members (group_id);
-- Two members in the same group can't share a display name — that name is
-- how people pick "who paid" / "who's in on this" in the UI, so it has to
-- be unambiguous within a group (not globally; the same name is fine in a
-- different group).
CREATE UNIQUE INDEX IF NOT EXISTS idx_members_group_name ON members (group_id, lower(name));

CREATE TABLE IF NOT EXISTS expenses (
  id SERIAL PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  payer_id INTEGER NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  description TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_expenses_group ON expenses (group_id, created_at DESC);

-- Who an expense is split between, and each person's exact share. Stored
-- explicitly (not recomputed from a participant list on every read) so the
-- split is a permanent fact about the expense, independent of whether the
-- group's member list changes later.
CREATE TABLE IF NOT EXISTS expense_participants (
  expense_id INTEGER NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  share_cents INTEGER NOT NULL CHECK (share_cents > 0),
  PRIMARY KEY (expense_id, member_id)
);
CREATE INDEX IF NOT EXISTS idx_participants_member ON expense_participants (member_id);
