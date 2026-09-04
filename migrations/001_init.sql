CREATE TABLE IF NOT EXISTS api_keys (
  token       text PRIMARY KEY,
  role        text NOT NULL CHECK (role IN ('viewer', 'poster', 'admin')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS channels (
  id          uuid PRIMARY KEY,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS signals (
  id          uuid PRIMARY KEY,
  channel_id  uuid NOT NULL REFERENCES channels(id),
  status      text NOT NULL CHECK (status IN ('ok', 'warn', 'down')),
  message     text NOT NULL,
  actor       text NOT NULL,
  ts          text NOT NULL
);
CREATE INDEX IF NOT EXISTS signals_channel_ts ON signals (channel_id, ts DESC);

-- Audit columns are text on purpose: the hash chain commits to exact
-- serialized bytes; jsonb/timestamptz round-trips could alter them.
CREATE TABLE IF NOT EXISTS audit_log (
  seq        bigint PRIMARY KEY,
  ts         text NOT NULL,
  actor      text NOT NULL,
  action     text NOT NULL,
  details    text NOT NULL,
  prev_hash  text NOT NULL,
  hash       text NOT NULL
);
