-- URL import progress: the worker updates bytes as it downloads; the row is
-- removed when the download finishes (or the entry fails).
CREATE TABLE url_downloads (
    entry_id    bigint PRIMARY KEY REFERENCES entries(id) ON DELETE CASCADE,
    url         text NOT NULL,
    bytes       bigint NOT NULL DEFAULT 0,
    total_bytes bigint NOT NULL DEFAULT 0,
    updated_at  timestamptz NOT NULL DEFAULT now()
);
