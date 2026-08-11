CREATE TABLE domain_acls (
    id         bigserial PRIMARY KEY,
    title      text NOT NULL,
    whitelist  text[] NOT NULL DEFAULT '{}',
    blocklist  text[] NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE entries ADD COLUMN domain_acl_id bigint REFERENCES domain_acls(id) ON DELETE SET NULL;

-- Entries now either reference a named ACL or are "Allow All" (NULL).
-- The old inline policies are gone; existing restrictions are dropped.
UPDATE entries SET domain_acl_id = NULL;

ALTER TABLE entries DROP COLUMN embed_policy, DROP COLUMN embed_domains;

DELETE FROM settings WHERE key IN ('embed.default_policy', 'embed.default_allowlist');
