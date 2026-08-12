-- Player designs: the Default player is seeded here (first installation)
-- and is the site-wide fallback; it can never be deleted or edited.
CREATE TABLE players (
    id         BIGSERIAL PRIMARY KEY,
    name       TEXT NOT NULL,
    is_default BOOLEAN NOT NULL DEFAULT false,
    config     JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO players (name, is_default, config) VALUES ('Default', true, '{}'::jsonb);

ALTER TABLE entries ADD COLUMN player_id BIGINT REFERENCES players(id) ON DELETE SET NULL;
CREATE INDEX idx_entries_player_id ON entries(player_id);
