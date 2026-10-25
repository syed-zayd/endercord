import type {
  ChannelSettings, Env, RegisteredUser, Server, UserServer,
} from './types.js';

// ── Servers ────────────────────────────────────────────────────────────

export async function getActiveServer(env: Env, discordId: string): Promise<UserServer | null> {
  return env.DB.prepare(`
    SELECT s.*, us.is_default
    FROM servers s
    JOIN user_servers us ON us.server_id = s.id
    WHERE us.discord_id = ? AND us.is_default = 1
  `).bind(discordId).first<UserServer>();
}

export async function getAllUserServers(env: Env, discordId: string): Promise<UserServer[]> {
  const { results } = await env.DB.prepare(`
    SELECT s.*, us.is_default
    FROM servers s
    JOIN user_servers us ON us.server_id = s.id
    WHERE us.discord_id = ?
    ORDER BY us.is_default DESC, us.added_at ASC
  `).bind(discordId).all<UserServer>();
  return results;
}

export async function getServerById(env: Env, serverId: number): Promise<Server | null> {
  return env.DB.prepare('SELECT * FROM servers WHERE id = ?').bind(serverId).first<Server>();
}

export async function getServerBySecret(env: Env, secret: string): Promise<Server | null> {
  return env.DB.prepare('SELECT * FROM servers WHERE secret = ?').bind(secret).first<Server>();
}

export async function upsertServer(
  env: Env, host: string, pluginUrl: string, secret: string, mcPort: number,
  serverKey: string | null, displayName: string | null,
): Promise<number> {
  const existing = await env.DB.prepare('SELECT id FROM servers WHERE secret = ?')
    .bind(secret).first<{ id: number }>();
  if (existing) {
    await env.DB.prepare(
      'UPDATE servers SET host = ?, plugin_url = ?, mc_port = ?, server_key = ?, display_name = ? WHERE id = ?',
    ).bind(host, pluginUrl, mcPort, serverKey, displayName, existing.id).run();
    return existing.id;
  }
  const result = await env.DB.prepare(
    'INSERT INTO servers (host, plugin_url, secret, mc_port, added_at, server_key, display_name) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).bind(host, pluginUrl, secret, mcPort, Math.floor(Date.now() / 1000), serverKey, displayName).run();
  return result.meta.last_row_id as number;
}

// The user's server whose plugin generated this key, if they have access to it.
export async function getUserServerByKey(env: Env, discordId: string, serverKey: string): Promise<Server | null> {
  return env.DB.prepare(`
    SELECT s.* FROM servers s
    JOIN user_servers us ON us.server_id = s.id
    WHERE us.discord_id = ? AND s.server_key = ?
  `).bind(discordId, serverKey).first<Server>();
}

// ── Pending /link invites ──────────────────────────────────────────────

export async function addPendingLink(env: Env, serverId: number, username: string): Promise<void> {
  await env.DB.prepare(`
    INSERT INTO pending_links (server_id, username, created_at) VALUES (?, ?, ?)
    ON CONFLICT (server_id, username) DO UPDATE SET created_at = excluded.created_at
  `).bind(serverId, username.toLowerCase(), Math.floor(Date.now() / 1000)).run();
}

export async function getPendingLinkServers(env: Env, username: string): Promise<Server[]> {
  const { results } = await env.DB.prepare(`
    SELECT s.* FROM servers s
    JOIN pending_links p ON p.server_id = s.id
    WHERE p.username = ? AND p.created_at > ?
  `).bind(username.toLowerCase(), Math.floor(Date.now() / 1000) - 30 * 60).all<Server>();
  return results;
}

export async function removePendingLink(env: Env, serverId: number, username: string): Promise<void> {
  await env.DB.prepare('DELETE FROM pending_links WHERE server_id = ? AND username = ?')
    .bind(serverId, username.toLowerCase()).run();
}

// ── Users ──────────────────────────────────────────────────────────────

export async function getRegisteredUser(env: Env, discordId: string): Promise<RegisteredUser | null> {
  return env.DB.prepare('SELECT * FROM registered_users WHERE discord_id = ?')
    .bind(discordId).first<RegisteredUser>();
}

export async function getUserByName(env: Env, username: string): Promise<RegisteredUser | null> {
  return env.DB.prepare('SELECT * FROM registered_users WHERE LOWER(username) = LOWER(?)')
    .bind(username).first<RegisteredUser>();
}

export async function registerUser(env: Env, discordId: string, username: string): Promise<void> {
  await env.DB.prepare(`
    INSERT INTO registered_users (discord_id, username, allow_ops, registered_at)
    VALUES (?, ?, 1, ?)
    ON CONFLICT(discord_id) DO UPDATE SET username = excluded.username, allow_ops = 1
  `).bind(discordId, username, Math.floor(Date.now() / 1000)).run();
}

export async function setAllowOps(env: Env, discordId: string, username: string, allow: boolean): Promise<void> {
  await env.DB.prepare(`
    INSERT INTO registered_users (discord_id, username, allow_ops, registered_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(discord_id) DO UPDATE SET allow_ops = excluded.allow_ops
  `).bind(discordId, username, allow ? 1 : 0, Math.floor(Date.now() / 1000)).run();
}

// ── User–Server associations ───────────────────────────────────────────

export async function addUserToServer(env: Env, discordId: string, serverId: number): Promise<boolean> {
  const existing = await env.DB.prepare(
    'SELECT 1 FROM user_servers WHERE discord_id = ? AND server_id = ?',
  ).bind(discordId, serverId).first();
  if (existing) return false;

  const hasAny = await env.DB.prepare(
    'SELECT 1 FROM user_servers WHERE discord_id = ?',
  ).bind(discordId).first();

  await env.DB.prepare(`
    INSERT INTO user_servers (discord_id, server_id, is_default, added_at)
    VALUES (?, ?, ?, ?)
  `).bind(discordId, serverId, hasAny ? 0 : 1, Math.floor(Date.now() / 1000)).run();
  return true;
}

export async function removeUserFromServer(
  env: Env, discordId: string, serverId: number,
): Promise<string | null> {
  const server = await getServerById(env, serverId);
  const existing = await env.DB.prepare(
    'SELECT is_default FROM user_servers WHERE discord_id = ? AND server_id = ?',
  ).bind(discordId, serverId).first<{ is_default: number }>();
  if (!existing) return null;

  await env.DB.prepare(
    'DELETE FROM user_servers WHERE discord_id = ? AND server_id = ?',
  ).bind(discordId, serverId).run();

  if (existing.is_default) {
    const next = await env.DB.prepare(
      'SELECT server_id FROM user_servers WHERE discord_id = ? ORDER BY added_at ASC LIMIT 1',
    ).bind(discordId).first<{ server_id: number }>();
    if (next) {
      await env.DB.prepare(
        'UPDATE user_servers SET is_default = 1 WHERE discord_id = ? AND server_id = ?',
      ).bind(discordId, next.server_id).run();
    }
  }

  return server?.host ?? String(serverId);
}

export async function setDefaultServer(env: Env, discordId: string, serverId: number): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('UPDATE user_servers SET is_default = 0 WHERE discord_id = ?').bind(discordId),
    env.DB.prepare('UPDATE user_servers SET is_default = 1 WHERE discord_id = ? AND server_id = ?')
      .bind(discordId, serverId),
  ]);
}

// ── Meta (key/value) ───────────────────────────────────────────────────

export async function getMeta(env: Env, key: string): Promise<string | null> {
  const row = await env.DB.prepare('SELECT value FROM meta WHERE key = ?')
    .bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

export async function setMeta(env: Env, key: string, value: string): Promise<void> {
  await env.DB.prepare(`
    INSERT INTO meta (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).bind(key, value).run();
}

// ── Channel settings ───────────────────────────────────────────────────

export async function getChannelSettings(env: Env, channelId: string): Promise<ChannelSettings | null> {
  return env.DB.prepare('SELECT * FROM channel_settings WHERE channel_id = ?')
    .bind(channelId).first<ChannelSettings>();
}

export async function getChannelsByServer(env: Env, serverId: number): Promise<ChannelSettings[]> {
  const { results } = await env.DB.prepare(
    'SELECT * FROM channel_settings WHERE server_id = ?',
  ).bind(serverId).all<ChannelSettings>();
  return results;
}

export async function upsertChannelSetting(
  env: Env, channelId: string, serverId: number,
  category: 'join_notif' | 'leave_notif' | 'pingguard_notif', value: string,
): Promise<void> {
  await env.DB.prepare(`
    INSERT INTO channel_settings (channel_id, server_id, join_notif, leave_notif, pingguard_notif)
    VALUES (?, ?, 'off', 'off', 'off')
    ON CONFLICT(channel_id) DO NOTHING
  `).bind(channelId, serverId).run();
  await env.DB.prepare(
    `UPDATE channel_settings SET ${category} = ? WHERE channel_id = ?`,
  ).bind(value, channelId).run();
}
