-- Persist the chosen poster sprite-frame per entry so the admin dialog can
-- reopen the poster tab on the frame that produced the current poster.
ALTER TABLE entries ADD COLUMN poster_frame INTEGER NOT NULL DEFAULT 0;
