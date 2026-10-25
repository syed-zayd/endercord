import { COLORS } from './discord.js';
import type { DiscordEmbed, PluginPlayer, PluginSession, SlotItem } from './types.js';

function itemName(id: string): string {
  return id.replace('minecraft:', '').replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

export function buildOverviewEmbed(data: PluginPlayer): DiscordEmbed {
  const embed: DiscordEmbed = {
    title: `${data.name} — Overview`,
    color: data.online ? COLORS.GREEN : COLORS.GRAY,
    fields: [],
  };

  const statusLine = data.online
    ? '🟢 Online'
    : data.last_seen ? `⚫ Last seen <t:${data.last_seen}:R>` : '⚫ Offline';

  const bars = (val: number, max: number, full: string, empty: string) => {
    const filled = Math.round((val / max) * 10);
    return full.repeat(filled) + empty.repeat(10 - filled);
  };

  embed.fields = [
    { name: 'Status', value: statusLine, inline: true },
    { name: 'Gamemode', value: data.gamemode.charAt(0).toUpperCase() + data.gamemode.slice(1).toLowerCase(), inline: true },
    { name: '​', value: '​', inline: true },
    {
      name: '❤️ Health',
      value: `${bars(data.health, data.max_health, '❤️', '🖤')} ${data.health}/${data.max_health}`,
      inline: true,
    },
    {
      name: '🍖 Food',
      value: `${bars(data.food, 20, '🍖', '🩶')} ${data.food}/20`,
      inline: true,
    },
    { name: '​', value: '​', inline: true },
    { name: '⭐ Level', value: `${data.xp_level} (${Math.round(data.xp_progress * 100)}% to next)`, inline: true },
  ];

  if (data.location) {
    const { world, x, y, z } = data.location;
    embed.fields.push({
      name: '📍 Location',
      value: `${world} — ${Math.round(x)}, ${Math.round(y)}, ${Math.round(z)}`,
      inline: true,
    });
  }

  const inv = data.inventory;
  if (inv) {
    const armor = inv.armor;
    const armorLines = (
      [['helmet', 'Helmet'], ['chestplate', 'Chestplate'], ['leggings', 'Leggings'], ['boots', 'Boots']] as const
    ).map(([k, label]) => `${label}: ${armor[k] ? itemName(armor[k]!.id) : '—'}`);
    embed.fields!.push({ name: '🪖 Armor', value: armorLines.join('\n'), inline: true });

    const hotbarMap = new Map(inv.hotbar.map(s => [s.slot, s.item]));
    const hotbarLines: string[] = [];
    for (let i = 0; i < 9; i++) {
      const item = hotbarMap.get(i);
      hotbarLines.push(item
        ? `\`${i + 1}\` ${itemName(item.id)}${item.count > 1 ? ` ×${item.count}` : ''}`
        : `\`${i + 1}\` —`);
    }
    if (inv.offhand) {
      const o = inv.offhand;
      hotbarLines.push(`\`✋\` ${itemName(o.id)}${o.count > 1 ? ` ×${o.count}` : ''}`);
    }
    embed.fields!.push({ name: '🎒 Hotbar', value: hotbarLines.join('\n'), inline: true });
  }

  embed.footer = { text: data.online ? 'Live data' : 'Data from last save · may be outdated' };
  return embed;
}

export function buildInventoryEmbed(data: PluginPlayer): DiscordEmbed {
  const slots = data.inventory?.main ?? [];
  const lines = slots.map(s =>
    `\`${s.slot + 1}\` ${itemName(s.item.id)}${s.item.count > 1 ? ` ×${s.item.count}` : ''}`
  );
  return {
    title: `${data.name} — Inventory`,
    description: lines.length ? lines.join('\n') : '*Empty*',
    color: COLORS.BLURPLE,
    footer: { text: 'Main storage (27 slots) · armor and hotbar shown on Overview' },
  };
}

export function buildEnderChestEmbed(data: PluginPlayer): DiscordEmbed {
  const slots: SlotItem[] = data.ender_chest ?? [];
  const lines = [...slots].sort((a, b) => a.slot - b.slot).map(s =>
    `\`${s.slot + 1}\` ${itemName(s.item.id)}${s.item.count > 1 ? ` ×${s.item.count}` : ''}`
  );
  return {
    title: `${data.name} — Ender Chest`,
    description: lines.length ? lines.join('\n') : '*Empty*',
    color: COLORS.BLURPLE,
    footer: { text: 'Data from last save · may be outdated if player is online' },
  };
}

export function buildLoginsEmbed(sessions: PluginSession[], playerName: string, serverHost: string): DiscordEmbed {
  const lines = sessions.map(s => {
    if (!s.left_at) return `🟢 Online since <t:${s.joined_at}:R>`;
    return `<t:${s.joined_at}:t> → <t:${s.left_at}:t> · ${formatDuration(s.left_at - s.joined_at)}`;
  });
  return {
    title: `${playerName} — Login History`,
    description: lines.length ? lines.join('\n') : 'No sessions recorded.',
    color: COLORS.BLURPLE,
    footer: { text: `Last ${sessions.length} sessions · ${serverHost}` },
  };
}

/** Buttons row for the player view switcher. */
export function playerButtons(tab: string, serverId: number, playerName: string) {
  const btn = (label: string, emoji: string, t: string) => ({
    type: 2,
    style: tab === t ? 1 : 2, // PRIMARY if active, SECONDARY otherwise
    label,
    emoji: { name: emoji },
    custom_id: `player_btn:${t}:${serverId}:${playerName}`,
  });
  return [{
    type: 1,
    components: [
      btn('Overview',   '📊', 'overview'),
      btn('Inventory',  '🎒', 'inventory'),
      btn('Ender Chest','📦', 'ender_chest'),
      btn('Logins',     '📋', 'logins'),
    ],
  }];
}
