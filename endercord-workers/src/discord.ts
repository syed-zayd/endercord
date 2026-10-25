import type { DiscordEmbed, DiscordInteraction, DiscordUser, Env } from './types.js';

const API = 'https://discord.com/api/v10';

export const COLORS = {
  GREEN:   0x57F287,
  BLURPLE: 0x5865F2,
  YELLOW:  0xFEE75C,
  RED:     0xED4245,
  GRAY:    0x99AAB5,
} as const;

// ── Response helpers ───────────────────────────────────────────────────
// These return raw objects — callers wrap them in Response.json()

export function immediate(data: object, ephemeral = true) {
  return { type: 4, data: { ...data, ...(ephemeral ? { flags: 64 } : {}) } };
}

export function deferEphemeral() {
  return { type: 5, data: { flags: 64 } };
}

export function deferPublic() {
  return { type: 5 };
}

// For component interactions that need async work before updating the message
export function deferUpdate() {
  return { type: 6 };
}

// For component interactions that can update synchronously
export function updateMessage(data: object) {
  return { type: 7, data };
}

// ── Discord REST helpers ───────────────────────────────────────────────

function botHeaders(env: Env): HeadersInit {
  return { 'Content-Type': 'application/json', 'Authorization': `Bot ${env.BOT_TOKEN}` };
}

/** Edit the original deferred "thinking" placeholder. */
export async function editDeferred(env: Env, token: string, data: object): Promise<void> {
  const resp = await fetch(`${API}/webhooks/${env.DISCORD_APP_ID}/${token}/messages/@original`, {
    method: 'PATCH',
    headers: botHeaders(env),
    body: JSON.stringify(data),
  });
  if (!resp.ok) console.error('editDeferred failed:', await resp.text());
}

/** Edit the deferred placeholder with an attached file (e.g. a PNG icon referenced via attachment://). */
export async function editDeferredFile(
  env: Env, token: string, payload: object, file: { name: string; bytes: Uint8Array; contentType: string },
): Promise<void> {
  const form = new FormData();
  form.append('payload_json', JSON.stringify(payload));
  form.append('files[0]', new Blob([file.bytes], { type: file.contentType }), file.name);
  // No Content-Type header — FormData sets the multipart boundary itself.
  const resp = await fetch(`${API}/webhooks/${env.DISCORD_APP_ID}/${token}/messages/@original`, {
    method: 'PATCH',
    headers: { Authorization: `Bot ${env.BOT_TOKEN}` },
    body: form,
  });
  if (!resp.ok) console.error('editDeferredFile failed:', await resp.text());
}

/** Send a DM to a user. Opens the DM channel first if needed. */
export async function sendDM(env: Env, userId: string, data: object): Promise<void> {
  const dmResp = await fetch(`${API}/users/@me/channels`, {
    method: 'POST',
    headers: botHeaders(env),
    body: JSON.stringify({ recipient_id: userId }),
  });
  if (!dmResp.ok) { console.error('openDM failed:', await dmResp.text()); return; }
  const { id: channelId } = await dmResp.json() as { id: string };
  const msgResp = await fetch(`${API}/channels/${channelId}/messages`, {
    method: 'POST',
    headers: botHeaders(env),
    body: JSON.stringify(data),
  });
  if (!msgResp.ok) console.error('sendDM failed:', await msgResp.text());
}

/** Send a message to a guild channel. */
export async function sendChannelMessage(env: Env, channelId: string, data: object): Promise<void> {
  const resp = await fetch(`${API}/channels/${channelId}/messages`, {
    method: 'POST',
    headers: botHeaders(env),
    body: JSON.stringify(data),
  });
  if (!resp.ok) console.error('sendChannelMessage failed:', await resp.text());
}

// ── Utility ────────────────────────────────────────────────────────────

export function getUser(interaction: DiscordInteraction): DiscordUser {
  return (interaction.member?.user ?? interaction.user)!;
}

export function errorEmbed(description: string): DiscordEmbed {
  return { title: 'Error', description, color: COLORS.RED };
}

export function notFoundEmbed(name: string): DiscordEmbed {
  return {
    title: `Player not found: ${name}`,
    description: "This player doesn't exist or has no saved data.",
    color: COLORS.RED,
  };
}
