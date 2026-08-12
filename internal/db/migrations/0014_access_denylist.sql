-- 0014_access_denylist: shared logout denylist for access JWTs, so a logout
-- on one app node revokes the token on every node (multi-node safe).

CREATE TABLE access_denylist (
    token_hash text PRIMARY KEY,
    expires_at timestamptz NOT NULL
);
CREATE INDEX access_denylist_expires_idx ON access_denylist (expires_at);
