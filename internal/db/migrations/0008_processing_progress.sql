-- Per-flavor processing visibility: entry_flavors gains a 'transcoding'
-- status set while the worker encodes each flavor, and jobs gain a free-text
-- progress line (e.g. "Transcoding 1080p-h264 (2/4)") shown in the jobs page.
ALTER TABLE entry_flavors DROP CONSTRAINT entry_flavors_status_check;
ALTER TABLE entry_flavors ADD CONSTRAINT entry_flavors_status_check
    CHECK (status IN ('pending', 'done', 'failed', 'skipped', 'transcoding'));

ALTER TABLE jobs ADD COLUMN progress text;
