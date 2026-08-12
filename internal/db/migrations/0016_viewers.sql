-- Viewers: public library accounts (separate from staff users).
CREATE TABLE viewers (
    id            bigserial PRIMARY KEY,
    email         text NOT NULL UNIQUE,
    name_surname  text NOT NULL DEFAULT '',
    password_hash text NOT NULL,
    disabled      boolean NOT NULL DEFAULT false,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Viewer sessions mirror the staff refresh-token machinery.
CREATE TABLE viewer_refresh_tokens (
    id         bigserial PRIMARY KEY,
    viewer_id  bigint NOT NULL REFERENCES viewers(id) ON DELETE CASCADE,
    token_hash text NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    revoked    boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX viewer_refresh_tokens_viewer_idx ON viewer_refresh_tokens (viewer_id);
