CREATE TABLE IF NOT EXISTS servers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  host       TEXT    NOT NULL,
  plugin_url TEXT    NOT NULL,
  secret     TEXT    NOT NULL,
  mc_port    INTEGER NOT NULL DEFAULT 25565,
  added_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS registered_users (
  discord_id    TEXT    PRIMARY KEY,
  username      TEXT    NOT NULL,
  allow_ops     INTEGER NOT NULL DEFAULT 1,
  registered_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_servers (
  discord_id TEXT    NOT NULL,
  server_id  INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  is_default INTEGER NOT NULL DEFAULT 0,
  added_at   INTEGER NOT NULL,
  PRIMARY KEY (discord_id, server_id)
);

CREATE TABLE IF NOT EXISTS channel_settings (
  channel_id    TEXT    PRIMARY KEY,
  server_id     INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  join_notif    TEXT    NOT NULL DEFAULT 'off',
  leave_notif   TEXT    NOT NULL DEFAULT 'off',
  pingguard_notif TEXT  NOT NULL DEFAULT 'off'
);

-- Small key/value store. Used to track the registered slash-command hash
-- so /commands/sync only re-registers with Discord when commands change.
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
