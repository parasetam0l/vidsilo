-- 0015_audit_events: persistent audit trail of mutating admin actions.

CREATE TABLE audit_events (
    id          bigserial PRIMARY KEY,
    actor_id    bigint REFERENCES users(id) ON DELETE SET NULL,
    actor_email text NOT NULL DEFAULT '',
    action      text NOT NULL,
    entity      text NOT NULL,
    entity_id   text NOT NULL DEFAULT '',
    detail      text NOT NULL DEFAULT '',
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_created_idx ON audit_events (created_at DESC);
CREATE INDEX audit_events_entity_idx ON audit_events (entity, entity_id);
