ALTER TABLE accounts ADD COLUMN welcome_credits_eligible INTEGER NOT NULL DEFAULT 0
  CHECK (welcome_credits_eligible IN (0, 1));
ALTER TABLE accounts ADD COLUMN welcome_credits_granted_at INTEGER;
