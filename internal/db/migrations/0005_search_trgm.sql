-- Search: pg_trgm GIN indexes keep ILIKE '%term%' on title/description
-- index-assisted as the catalog grows (patterns < 3 chars fall back to a
-- sequential scan, which is correct for such short terms).
--
-- WITH SCHEMA public pins the extension regardless of search_path: test
-- bootstraps run migrations with search_path=<isolated schema>,public,
-- and a bare CREATE EXTENSION would plant gin_trgm_ops in the first
-- process's schema, breaking every other parallel test process. Migrations
-- run serialized under the bootstrap advisory lock, so with public pinned
-- there is never a concurrent CREATE EXTENSION.
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

CREATE INDEX entries_title_trgm_idx ON entries USING gin (title gin_trgm_ops);
CREATE INDEX entries_description_trgm_idx ON entries USING gin (description gin_trgm_ops);
