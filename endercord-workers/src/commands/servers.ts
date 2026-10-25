import { COLORS, deferUpdate, getUser, immediate, updateMessage } from '../discord.js';
import { getAllUserServers, registerUser, removeUserFromServer, setAllowOps, setDefaultServer } from '../db.js';
import type { DiscordInteraction, Env, InteractionOption } from '../types.js';

export async function handleServersCommand(
  interaction: DiscordInteraction, env: Env,
): Promise<object> {
  const sub = interaction.data!.options![0] as InteractionOption;
  const user = getUser(interaction);

  switch (sub.name) {
    case 'list':    return serversList(interaction, env, user.id, user.username);
    case 'switch':  return serversSwitch(interaction, env, user.id, sub);
    case 'remove':  return serversRemove(interaction, env, user.id, sub);
    case 'allowadds': return serversAllowAdds(env, user.id, user.username);
    case 'denyadds':  return serversDenyAdds(env, user.id, user.username);
    default: return immediate({ content: 'Unknown subcommand.' });
  }
}

async function serversList(
  interaction: DiscordInteraction, env: Env, discordId: string, username: string,
): Promise<object> {
  const servers = await getAllUserServers(env, discordId);
  if (!servers.length) {
    await registerUser(env, discordId, username);
    return immediate({
      embeds: [{
        title: 'No servers yet',
        description:
          "You're registered. To get access to a Minecraft server, ask a server operator to run one of these in the server console:\n\n" +
          `\`\`\`\n/endercord whitelist add ${username}\n\`\`\`\n` +
          `\`\`\`\n/endercord whitelist add ${discordId}\n\`\`\`\n` +
          "Once added you'll get a DM and it'll be set as your active server.",
        color: COLORS.BLURPLE,
      }],
    });
  }
  const lines = servers.map(s =>
    `• \`${s.host}\`${s.is_default ? ' **(active)**' : ''}`
  );
  return immediate({
    embeds: [{
      title: 'Your Minecraft Servers',
      description: lines.join('\n'),
      color: COLORS.BLURPLE,
      footer: { text: 'Use /servers switch to change your active server' },
    }],
  });
}

async function serversSwitch(
  interaction: DiscordInteraction, env: Env, discordId: string, sub: InteractionOption,
): Promise<object> {
  const servers = await getAllUserServers(env, discordId);
  if (!servers.length) {
    return immediate({ content: "You don't have access to any servers. Run `/servers list` for instructions." });
  }

  const query = sub.options?.find(o => o.name === 'server')?.value as string | undefined;

  if (query) {
    const match = servers.find(s => s.host.toLowerCase().includes(query.toLowerCase()));
    if (!match) {
      return immediate({ content: `No server matching \`${query}\`. Your servers: ${servers.map(s => s.host).join(', ')}` });
    }
    await setDefaultServer(env, discordId, match.id);
    return immediate({ content: `Switched active server to \`${match.host}\`.` });
  }

  if (servers.length === 1) {
    return immediate({ content: `Your only server is \`${servers[0].host}\`.` });
  }

  return immediate({
    content: 'Select your active server:',
    components: [{
      type: 1,
      components: [{
        type: 3,
        custom_id: 'servers_switch',
        placeholder: 'Choose a server',
        options: servers.map(s => ({
          label: s.host,
          value: String(s.id),
          default: Boolean(s.is_default),
        })),
      }],
    }],
  });
}

async function serversRemove(
  interaction: DiscordInteraction, env: Env, discordId: string, sub: InteractionOption,
): Promise<object> {
  const servers = await getAllUserServers(env, discordId);
  if (!servers.length) {
    return immediate({ content: "You're not associated with any servers." });
  }

  const query = sub.options?.find(o => o.name === 'server')?.value as string | undefined;

  if (query || servers.length === 1) {
    const target = query
      ? servers.find(s => s.host.toLowerCase().includes(query.toLowerCase()))
      : servers[0];
    if (!target) {
      return immediate({ content: `No server matching \`${query}\`. Your servers: ${servers.map(s => s.host).join(', ')}` });
    }
    await removeUserFromServer(env, discordId, target.id);
    return immediate({ content: `Removed yourself from \`${target.host}\`.` });
  }

  return immediate({
    content: 'Select a server to leave:',
    components: [{
      type: 1,
      components: [{
        type: 3,
        custom_id: 'servers_remove',
        placeholder: 'Choose a server to leave',
        options: servers.map(s => ({ label: s.host, value: String(s.id) })),
      }],
    }],
  });
}

async function serversAllowAdds(env: Env, discordId: string, username: string): Promise<object> {
  await setAllowOps(env, discordId, username, true);
  return immediate({ content: 'Server operators can now add you via this bot using `/endercord whitelist add <your_username>`.' });
}

async function serversDenyAdds(env: Env, discordId: string, username: string): Promise<object> {
  await setAllowOps(env, discordId, username, false);
  return immediate({ content: 'Server operators can no longer add you via this bot. Run `/servers allowadds` to re-enable.' });
}

// ── Component handlers ─────────────────────────────────────────────────

export async function handleServersSwitch(interaction: DiscordInteraction, env: Env): Promise<object> {
  const discordId = getUser(interaction).id;
  const serverId = parseInt(interaction.data!.values![0]);
  const servers = await getAllUserServers(env, discordId);
  const match = servers.find(s => s.id === serverId);
  if (!match) return updateMessage({ content: 'Server not found.' });
  await setDefaultServer(env, discordId, serverId);
  return updateMessage({ content: `Switched active server to \`${match.host}\`.`, components: [] });
}

export async function handleServersRemove(interaction: DiscordInteraction, env: Env): Promise<object> {
  const discordId = getUser(interaction).id;
  const serverId = parseInt(interaction.data!.values![0]);
  const host = await removeUserFromServer(env, discordId, serverId);
  if (!host) return updateMessage({ content: 'Server not found.' });
  return updateMessage({ content: `Removed yourself from \`${host}\`.`, components: [] });
}
