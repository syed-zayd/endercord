import { COLORS, getUser, immediate, updateMessage } from '../discord.js';
import { getActiveServer, getChannelSettings, getChannelsByServer, upsertChannelSetting } from '../db.js';
import type { ChannelSettings, DiscordInteraction, Env } from '../types.js';

const CATEGORIES = [
  { key: 'join_notif',      label: 'Joins' },
  { key: 'leave_notif',     label: 'Leaves' },
  { key: 'pingguard_notif', label: 'IP Whitelist' },
] as const;

const STATE_LABELS: Record<string, string> = { off: 'Off', notify: 'Message', ping: 'Ping' };

function buildSelectMenus(settings: ChannelSettings) {
  return CATEGORIES.map(({ key, label }) => ({
    type: 1,
    components: [{
      type: 3,
      custom_id: `notif:${key}:${settings.server_id}:${settings.channel_id}`,
      placeholder: label,
      options: ['off', 'notify', 'ping'].map(v => ({
        label: `${label}: ${STATE_LABELS[v]}`,
        value: v,
        default: settings[key] === v,
      })),
    }],
  }));
}

function buildSummaryEmbed(settings: ChannelSettings) {
  const lines = CATEGORIES.map(({ key, label }) => {
    const state = settings[key];
    const indicator = state === 'off' ? '⚫' : state === 'notify' ? '🔵' : '🔔';
    return `${indicator} **${label}**: ${STATE_LABELS[state]}`;
  });
  return {
    title: 'Notification Settings',
    description: lines.join('\n'),
    color: COLORS.BLURPLE,
    footer: { text: `Channel: ${settings.channel_id} · Server: ${settings.server_id}` },
  };
}

// ── /notifs ────────────────────────────────────────────────────────────

export async function handleNotifsCommand(
  interaction: DiscordInteraction, env: Env,
): Promise<object> {
  const server = await getActiveServer(env, getUser(interaction).id);
  if (!server) return immediate({ content: "No active server. Run `/servers list` for instructions." });

  const channels = await getChannelsByServer(env, server.id);
  if (!channels.length) {
    return immediate({
      embeds: [{
        title: 'No notification channels configured',
        description: 'Use `/setnotifs` in a channel to configure notifications.',
        color: COLORS.GRAY,
      }],
    });
  }

  const lines = channels.map(ch => {
    const active = CATEGORIES.filter(c => ch[c.key] !== 'off').map(c => `${c.label}: ${STATE_LABELS[ch[c.key]]}`);
    return `<#${ch.channel_id}>: ${active.length ? active.join(', ') : 'nothing'}`;
  });

  return immediate({
    embeds: [{
      title: 'Notification Channels',
      description: lines.join('\n'),
      color: COLORS.BLURPLE,
      footer: { text: server.host },
    }],
  });
}

// ── /setnotifs ─────────────────────────────────────────────────────────

export async function handleSetNotifsCommand(
  interaction: DiscordInteraction, env: Env,
): Promise<object> {
  const server = await getActiveServer(env, getUser(interaction).id);
  if (!server) return immediate({ content: "No active server. Run `/servers list` for instructions." });

  // Resolved channel from option, or fall back to current channel
  const channelOption = interaction.data!.options?.find(o => o.name === 'channel');
  const channelId = channelOption
    ? String(channelOption.value)
    : interaction.channel_id!;

  let settings = await getChannelSettings(env, channelId);
  if (!settings) {
    // Initialise with defaults
    await upsertChannelSetting(env, channelId, server.id, 'join_notif', 'off');
    settings = (await getChannelSettings(env, channelId))!;
  }

  return immediate({
    embeds: [buildSummaryEmbed(settings)],
    components: buildSelectMenus(settings),
  });
}

// ── Notif select component handler ─────────────────────────────────────

export async function handleNotifSelect(
  interaction: DiscordInteraction, env: Env,
): Promise<object> {
  // custom_id: notif:{category}:{server_id}:{channel_id}
  const parts = interaction.data!.custom_id!.split(':');
  const category = parts[1] as 'join_notif' | 'leave_notif' | 'pingguard_notif';
  const serverId = parseInt(parts[2]);
  const channelId = parts[3];
  const value = interaction.data!.values![0];

  await upsertChannelSetting(env, channelId, serverId, category, value);
  const settings = (await getChannelSettings(env, channelId))!;

  return updateMessage({
    embeds: [buildSummaryEmbed(settings)],
    components: buildSelectMenus(settings),
  });
}
