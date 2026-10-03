-- Each tab is kept in one currency, chosen when the tab is created and never
-- changed afterwards (there is no conversion, so switching a tab that already
-- has amounts in it would silently change what they mean).
-- Tabs that already exist were entered as dollars, so they become USD; new
-- tabs default to Ghana cedis.
ALTER TABLE groups
  ADD COLUMN currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency IN ('GHS', 'USD'));
ALTER TABLE groups ALTER COLUMN currency SET DEFAULT 'GHS';
