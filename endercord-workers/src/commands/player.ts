import type { RequestExecutionContext } from '../types.js';
import { deferEphemeral, deferUpdate, editDeferred, errorEmbed, getUser, notFoundEmbed } from '../discord.js';
import { getAllUserServers, getActiveServer, getServerById } from '../db.js';
import { buildEnderChestEmbed, buildInventoryEmbed, buildLoginsEmbed, buildOverviewEmbed, playerButtons } from '../embeds.js';
import { pluginGet } from '../plugin.js';
import type { DiscordInteraction, Env, InteractionOption, PluginPlayer, PluginSession, RequestCtx } from '../types.js';

type Tab = 'overview' | 'inventory' | 'ender_chest' | 'logins';

export function handlePlayerCommand(
  interaction: DiscordInteraction, env: Env, ctx: RequestExecutionContext, reqCtx: RequestCtx,
): object {
  const sub = interaction.data!.options![0] as InteractionOption;
  const name = sub.options!.find(o => o.name === 'name')!.value as string;
  const count = sub.options?.find(o => o.name === 'count')?.value as number ?? 10;
  const tab = sub.name === 'echest' ? 'ender_chest' : sub.name as Tab;
  ctx.waitUntil(fetchAndRespond(interaction, env, name, tab, count, reqCtx));
  return deferEphemeral();
}

async function fetchAndRespond(
  interaction: DiscordInteraction, env: Env, name: string, tab: Tab, count: number, reqCtx: RequestCtx,
): Promise<void> {
  const server = await getActiveServer(env, getUser(interaction).id);
  if (!server) {
    await editDeferred(env, interaction.token, {
      embeds: [errorEmbed("You don't have access to any Minecraft servers. Run `/servers list` for instructions.")],
    });
    return;
  }

  const [[pStatus, playerData], [sStatus, sessionsData]] = await Promise.all([
    pluginGet<PluginPlayer>(server, `/player/${name}`, reqCtx),
    pluginGet<{ sessions: PluginSession[] }>(server, `/sessions/${name}?count=${count}`, reqCtx),
  ]);

  if (pStatus !== 200) { await editDeferred(env, interaction.token, { embeds: [notFoundEmbed(name)] }); return; }

  const sessions = sStatus === 200 ? (sessionsData.sessions ?? []) : [];
  const canonical = playerData.name ?? name;

  await editDeferred(env, interaction.token, {
    embeds: [buildTabEmbed(tab, playerData, sessions, canonical, server.host)],
    components: playerButtons(tab, server.id, canonical),
  });
}

function buildTabEmbed(tab: Tab, playerData: PluginPlayer, sessions: PluginSession[], name: string, host: string) {
  switch (tab) {
    case 'overview':    return buildOverviewEmbed(playerData);
    case 'inventory':   return buildInventoryEmbed(playerData);
    case 'ender_chest': return buildEnderChestEmbed(playerData);
    case 'logins':      return buildLoginsEmbed(sessions, name, host);
  }
}

// ── Button handler ─────────────────────────────────────────────────────

export function handlePlayerButton(
  interaction: DiscordInteraction, env: Env, ctx: RequestExecutionContext, reqCtx: RequestCtx,
): object {
  const [, tab, serverIdStr, ...nameParts] = interaction.data!.custom_id!.split(':');
  const playerName = nameParts.join(':');
  const serverId = parseInt(serverIdStr);
  ctx.waitUntil(fetchAndUpdateButton(interaction, env, tab as Tab, serverId, playerName, reqCtx));
  return deferUpdate();
}

async function fetchAndUpdateButton(
  interaction: DiscordInteraction, env: Env, tab: Tab, serverId: number, playerName: string, reqCtx: RequestCtx,
): Promise<void> {
  const discordId = getUser(interaction).id;
  const server = await getServerById(env, serverId);
  if (!server) return;

  const userServers = await getAllUserServers(env, discordId);
  if (!userServers.find(s => s.id === serverId)) return;

  const [[pStatus, playerData], [sStatus, sessionsData]] = await Promise.all([
    pluginGet<PluginPlayer>(server, `/player/${playerName}`, reqCtx),
    pluginGet<{ sessions: PluginSession[] }>(server, `/sessions/${playerName}?count=10`, reqCtx),
  ]);

  if (pStatus !== 200) return;

  const sessions = sStatus === 200 ? (sessionsData.sessions ?? []) : [];
  const canonical = playerData.name ?? playerName;

  await fetch(
    `https://discord.com/api/v10/webhooks/${env.DISCORD_APP_ID}/${interaction.token}/messages/@original`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bot ${env.BOT_TOKEN}` },
      body: JSON.stringify({
        embeds: [buildTabEmbed(tab, playerData, sessions, canonical, server.host)],
        components: playerButtons(tab, serverId, canonical),
      }),
    },
  );
}
