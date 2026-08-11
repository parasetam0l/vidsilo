-- Access control: an entry can be hidden from all viewers (except
-- editors/admins who manage it) without deleting it. False = accessible.
ALTER TABLE entries ADD COLUMN access_denied bool NOT NULL DEFAULT false;
