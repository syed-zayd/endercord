// Slash-command definitions + registration with Discord.
//
// Registration runs server-side (in the Worker) using the Worker's own
// BOT_TOKEN/DISCORD_APP_ID — there is no local copy of the token. The
// `/commands/sync` route calls syncCommands(); it's hash-gated so it only
// hits Discord when the command set below actually changes.

import { getMeta, setMeta } from './db.js';
import type { Env } from './types.js';

const STR = 3, INT = 4, CHANNEL = 7;
const SUB = 1;

const META_KEY = 'commands_hash';

export const commands = [
  {
    name: 'servers',
    description: 'Manage your Minecraft server access',
    options: [
      { type: SUB, name: 'list',      description: 'Show your servers, or how to get access if you have none' },
      { type: SUB, name: 'switch',    description: 'Switch your active server',
        options: [{ type: STR, name: 'server', description: 'Server hostname to switch to', required: false }] },
      { type: SUB, name: 'remove',    description: 'Remove yourself from a server',
        options: [{ type: STR, name: 'server', description: 'Server to leave', required: false }] },
      { type: SUB, name: 'allowadds', description: 'Allow operators to add you via this bot' },
      { type: SUB, name: 'denyadds',  description: 'Prevent operators from adding you via this bot' },
    ],
  },
  {
    name: 'player',
    description: 'View player information',
    options: [
      { type: SUB, name: 'overview',  description: "View a player's stats and equipment",
        options: [{ type: STR, name: 'name', description: 'Player username', required: true }] },
      { type: SUB, name: 'inventory', description: "View a player's inventory",
        options: [{ type: STR, name: 'name', description: 'Player username', required: true }] },
      { type: SUB, name: 'echest',    description: "View a player's ender chest",
        options: [{ type: STR, name: 'name', description: 'Player username', required: true }] },
      { type: SUB, name: 'logins',    description: "View a player's recent login sessions",
        options: [
          { type: STR, name: 'name',  description: 'Player username', required: true },
          { type: INT, name: 'count', description: 'Number of sessions (default 10)', required: false, min_value: 1, max_value: 20 },
        ] },
    ],
  },
  {
    name: 'console',
    description: 'Run a Minecraft server console command',
    options: [{ type: STR, name: 'command', description: 'The command to run', required: true }],
  },
  { name: 'tps',  description: 'Show server TPS (ticks per second)' },
  { name: 'list', description: 'Show online players' },
  { name: 'serverinfo', description: 'Show live server status — MOTD, players, version, icon' },
  // Message context-menu command (right-click a message → Apps → Capture Proof). DEMO.
  { name: 'Capture Proof', type: 3 },
  { name: 'notifs', description: 'List notification channels configured for your active server' },
  {
    name: 'setnotifs',
    description: 'Configure join/leave/IP whitelist notifications for a channel',
    options: [{
      type: CHANNEL, name: 'channel',
      description: 'Channel to configure (defaults to current channel)',
      required: false,
      channel_types: [0], // GUILD_TEXT only
    }],
  },
];

// Stable, synchronous hash of the command set (FNV-1a, hex).
function commandsHash(): string {
  const json = JSON.stringify(commands);
  let h = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    h ^= json.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

export interface SyncResult {
  ok: boolean;
  skipped?: boolean;
  registered?: number;
  hash: string;
  error?: string;
}

// Registers the command set with Discord. No-ops (skipped) when the stored
// hash already matches, unless `force` is set.
export async function syncCommands(env: Env, force = false): Promise<SyncResult> {
  const hash = commandsHash();

  if (!force) {
    const stored = await getMeta(env, META_KEY);
    if (stored === hash) return { ok: true, skipped: true, hash };
  }

  const resp = await fetch(
    `https://discord.com/api/v10/applications/${env.DISCORD_APP_ID}/commands`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bot ${env.BOT_TOKEN}`,
      },
      body: JSON.stringify(commands),
    },
  );

  if (!resp.ok) {
    return { ok: false, hash, error: `Discord ${resp.status}: ${await resp.text()}` };
  }

  const registered = await resp.json() as unknown[];
  await setMeta(env, META_KEY, hash);
  return { ok: true, registered: registered.length, hash };
}
