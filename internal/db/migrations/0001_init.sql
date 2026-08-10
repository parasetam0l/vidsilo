-- 0001_init: full VOD platform schema

CREATE TABLE users (
    id            bigserial PRIMARY KEY,
    email         text NOT NULL,
    name_surname  text NOT NULL DEFAULT '',

    password_hash text NOT NULL,
    role          text NOT NULL CHECK (role IN ('admin', 'editor', 'uploader', 'viewer')) DEFAULT 'viewer',
    disabled      boolean NOT NULL DEFAULT false,
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_lower ON users (lower(email));

CREATE TABLE categories (
    id         bigserial PRIMARY KEY,
    parent_id  bigint REFERENCES categories(id) ON DELETE SET NULL,
    name       text NOT NULL,
    slug       text NOT NULL UNIQUE,
    position   int NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE flavors (
    id            bigserial PRIMARY KEY,
    name          text NOT NULL UNIQUE,
    label         text NOT NULL DEFAULT '',
    codec         text NOT NULL CHECK (codec IN ('h264', 'h265')),
    height        int NOT NULL CHECK (height > 0),
    video_mode    text NOT NULL CHECK (video_mode IN ('crf', 'bitrate')) DEFAULT 'crf',
    crf           float8,
    video_bitrate int,
    audio_bitrate int NOT NULL DEFAULT 128,
    preset        text NOT NULL DEFAULT 'veryfast',
    enabled       boolean NOT NULL DEFAULT false,
    position      int NOT NULL DEFAULT 0,
    created_at    timestamptz NOT NULL DEFAULT now(),
    CHECK ((video_mode = 'crf' AND crf IS NOT NULL) OR (video_mode = 'bitrate' AND video_bitrate IS NOT NULL))
);

CREATE TABLE entries (
    id           bigserial PRIMARY KEY,
    public_id    uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    category_id  bigint REFERENCES categories(id) ON DELETE SET NULL,
    uploaded_by  bigint REFERENCES users(id) ON DELETE SET NULL,
    title        text NOT NULL DEFAULT '',
    description  text NOT NULL DEFAULT '',
    status       text NOT NULL CHECK (status IN ('uploading', 'probing', 'transcoding', 'ready', 'failed')) DEFAULT 'uploading',
    duration_ms  bigint,
    source_key   text,
    source_size  bigint,
    is_public    boolean NOT NULL DEFAULT true,
    embed_policy text NOT NULL CHECK (embed_policy IN ('default', '*', 'same-origin', 'allowlist')) DEFAULT 'default',
    embed_domains text[] NOT NULL DEFAULT '{}',
    poster_key   text,
    sprite_key   text,
    sprite_frames int NOT NULL DEFAULT 0,
    error        text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX entries_status_idx ON entries (status);
CREATE INDEX entries_created_idx ON entries (created_at DESC);

CREATE TABLE entry_flavors (
    entry_id     bigint NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    flavor_id    bigint NOT NULL REFERENCES flavors(id) ON DELETE CASCADE,
    status       text NOT NULL CHECK (status IN ('pending', 'done', 'failed', 'skipped')) DEFAULT 'pending',
    error        text,
    playlist_key text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (entry_id, flavor_id)
);

-- Denormalized view used by the serving layer.
CREATE VIEW renditions AS
SELECT ef.entry_id, ef.flavor_id, f.label, f.height, f.video_bitrate AS bitrate, ef.playlist_key
FROM entry_flavors ef
JOIN flavors f ON f.id = ef.flavor_id
WHERE ef.status = 'done';

CREATE TABLE subtitles (
    id         bigserial PRIMARY KEY,
    entry_id   bigint NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    lang       text NOT NULL,
    label      text NOT NULL DEFAULT '',
    vtt_key    text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX subtitles_entry_idx ON subtitles (entry_id);

CREATE TABLE settings (
    key        text PRIMARY KEY,
    value      jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE jobs (
    id           bigserial PRIMARY KEY,
    type         text NOT NULL,
    entry_id     bigint REFERENCES entries(id) ON DELETE CASCADE,
    payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
    status       text NOT NULL CHECK (status IN ('queued', 'running', 'done', 'failed')) DEFAULT 'queued',
    attempts     int NOT NULL DEFAULT 0,
    max_attempts int NOT NULL DEFAULT 5,
    run_at       timestamptz NOT NULL DEFAULT now(),
    started_at   timestamptz,
    finished_at  timestamptz,
    error        text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_queue_idx ON jobs (status, run_at, id);

CREATE TABLE analytics_daily (
    entry_id      bigint NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    day           date NOT NULL,
    plays         bigint NOT NULL DEFAULT 0,
    watch_seconds bigint NOT NULL DEFAULT 0,
    bytes         bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (entry_id, day)
);
CREATE INDEX analytics_daily_day_idx ON analytics_daily (day);

CREATE TABLE analytics_viewers (
    entry_id  bigint NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    day       date NOT NULL,
    viewer_id text NOT NULL,
    seen_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (entry_id, day, viewer_id)
);
CREATE INDEX analytics_viewers_day_idx ON analytics_viewers (day);

CREATE TABLE analytics_totals (
    entry_id      bigint PRIMARY KEY REFERENCES entries(id) ON DELETE CASCADE,
    plays         bigint NOT NULL DEFAULT 0,
    watch_seconds bigint NOT NULL DEFAULT 0,
    bytes         bigint NOT NULL DEFAULT 0
);
