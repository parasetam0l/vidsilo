-- Search: pg_trgm GIN indexes keep ILIKE '%term%' on title/description
-- index-assisted as the catalog grows (patterns < 3 chars fall back to a
-- sequential scan, which is correct for such short terms).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX entries_title_trgm_idx ON entries USING gin (title gin_trgm_ops);
CREATE INDEX entries_description_trgm_idx ON entries USING gin (description gin_trgm_ops);
