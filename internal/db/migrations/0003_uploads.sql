-- 0003_uploads: tus upload metadata (spooled blobs live on local disk)

CREATE TABLE uploads (
    upload_id  text PRIMARY KEY,
    entry_id   bigint NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    meta       jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
