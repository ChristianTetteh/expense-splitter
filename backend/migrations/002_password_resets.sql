-- 002: password reset by email.
--
-- Only a SHA-256 hash of each reset token is stored (the raw token exists
-- only in the emailed link), so a leaked copy of this table can't be used to
-- take over accounts. A reset is single-use (used_at) and short-lived.
CREATE TABLE password_resets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  BYTEA NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ
);
CREATE INDEX password_resets_user_idx ON password_resets (user_id);
