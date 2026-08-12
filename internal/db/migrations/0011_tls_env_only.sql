-- TLS is now env-config (TLS_MODE/TLS_DOMAINS/TLS_CERT_FILE/TLS_KEY_FILE);
-- drop the legacy panel settings. Same pattern as 0004_domain_acls.sql.
DELETE FROM settings WHERE key IN ('tls.mode', 'tls.acme_domains', 'tls.cert_dir');
