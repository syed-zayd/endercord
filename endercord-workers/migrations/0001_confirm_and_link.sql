-- Upgrades a database created before /console confirmations and /link.
-- New databases get these from schema.sql.
ALTER TABLE servers ADD COLUMN server_key TEXT;
ALTER TABLE servers ADD COLUMN display_name TEXT;

CREATE TABLE IF NOT EXISTS pending_links (
  server_id  INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  username   TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (server_id, username)
);
