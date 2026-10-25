-- HookLab schema (Cloudflare D1 / SQLite)
-- All timestamps are Unix epoch milliseconds.

CREATE TABLE IF NOT EXISTS endpoints (
  id                       TEXT PRIMARY KEY,
  slug                     TEXT NOT NULL UNIQUE,
  token_hash               TEXT NOT NULL UNIQUE,
  token_hint               TEXT NOT NULL,
  name                     TEXT NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'active', -- active | paused | expired
  created_at               INTEGER NOT NULL,
  expires_at               INTEGER NOT NULL,
  max_requests             INTEGER NOT NULL,
  request_count            INTEGER NOT NULL DEFAULT 0,
  retention_minutes        INTEGER NOT NULL,
  rate_limit_per_minute    INTEGER NOT NULL DEFAULT 60,
  store_sensitive_headers  INTEGER NOT NULL DEFAULT 0,
  last_request_at          INTEGER,
  total_bytes              INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS requests (
  id             TEXT PRIMARY KEY,
  endpoint_id    TEXT NOT NULL REFERENCES endpoints(id) ON DELETE CASCADE,
  seq            INTEGER NOT NULL,
  received_at    INTEGER NOT NULL,
  expires_at     INTEGER NOT NULL,
  method         TEXT NOT NULL,
  path           TEXT NOT NULL,
  query_json     TEXT NOT NULL DEFAULT '[]',
  headers_json   TEXT NOT NULL DEFAULT '[]',
  redacted_json  TEXT NOT NULL DEFAULT '[]',
  content_type   TEXT,
  kind           TEXT NOT NULL,          -- json | form | text | binary | empty
  body_text      TEXT,
  body_base64    TEXT,
  body_encoding  TEXT NOT NULL DEFAULT 'utf8', -- utf8 | base64 | none
  body_size      INTEGER NOT NULL DEFAULT 0,
  body_sha256    TEXT,
  json_valid     INTEGER NOT NULL DEFAULT 0,
  origin         TEXT NOT NULL,          -- captured | synthetic
  user_agent     TEXT,
  ip_hash        TEXT,
  client_country TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_requests_endpoint_seq ON requests (endpoint_id, seq);
CREATE INDEX IF NOT EXISTS idx_requests_endpoint_received ON requests (endpoint_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_requests_expiry ON requests (expires_at);

CREATE TABLE IF NOT EXISTS replays (
  id               TEXT PRIMARY KEY,
  endpoint_id      TEXT NOT NULL REFERENCES endpoints(id) ON DELETE CASCADE,
  request_id       TEXT,
  created_at       INTEGER NOT NULL,
  target_url       TEXT NOT NULL,
  target_host      TEXT NOT NULL,
  method           TEXT NOT NULL,
  status_code      INTEGER,
  duration_ms      INTEGER,
  ok               INTEGER NOT NULL DEFAULT 0,
  error_code       TEXT,
  response_headers TEXT,
  response_preview TEXT,
  response_bytes   INTEGER,
  truncated        INTEGER NOT NULL DEFAULT 0,
  redirects        TEXT NOT NULL DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_replays_endpoint ON replays (endpoint_id, created_at DESC);

CREATE TABLE IF NOT EXISTS rate_limits (
  key          TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count        INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version', '1');
