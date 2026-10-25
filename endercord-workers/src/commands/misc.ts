import { COLORS, deferEphemeral, deferPublic, deferUpdate, editDeferred, errorEmbed, getUser, immediate, updateMessage } from '../discord.js';
import { getActiveServer, getUserServerByKey } from '../db.js';
import { pluginExec, pluginGet } from '../plugin.js';
import type { DiscordInteraction, Env, PluginPlayers, PluginTps, RequestCtx } from '../types.js';

// /console never runs anything directly. It shows a confirmation naming the server, and the plugin
// runs the command only from Discord's signed click on "Run" under exactly that text, so a bot
// that redirects or rewrites commands gets them refused.
export function confirmationText(command: string, serverName: string, serverKey: string): string {
  return `Run \`${command}\` on **${serverName}** (\`${serverKey}\`)?`;
}

export async function handleConsoleCommand(interaction: DiscordInteraction, env: Env): Promise<object> {
  const command = (interaction.data!.options!.find(o => o.name === 'command')!.value as string).trim();
  const server = await getActiveServer(env, getUser(interaction).id);
  if (!server) return immediate({ embeds: [noServerEmbed()] });
  if (!server.server_key || !server.display_name) {
    return immediate({ embeds: [errorEmbed('This server needs updating. Ask its operator to update Endercord and run `/endercord setup` again.')] });
  }
  if (!command || command.includes('`') || command.includes('\n')) {
    return immediate({ embeds: [errorEmbed('Console commands cannot contain backticks or line breaks.')] });
  }
  return immediate({
    content: confirmationText(command, server.display_name, server.server_key),
    components: [{
      type: 1,
      components: [
        { type: 2, style: 4, label: 'Run', custom_id: 'console_run' },
        { type: 2, style: 2, label: 'Cancel', custom_id: 'console_cancel' },
      ],
    }],
  });
}

export function handleConsoleButton(
  interaction: DiscordInteraction, env: Env, ctx: ExecutionContext, reqCtx: RequestCtx,
): object {
  if (interaction.data!.custom_id === 'console_cancel') return updateMessage({ content: 'Cancelled.', components: [] });
  ctx.waitUntil(runConsole(interaction, env, reqCtx));
  return deferUpdate();
}

async function runConsole(interaction: DiscordInteraction, env: Env, reqCtx: RequestCtx): Promise<void> {
  const content = interaction.message?.content ?? '';
  const key = content.match(/\(`([^`]+)`\)\?$/)?.[1];
  const command = content.match(/^Run `([^`]*)`/)?.[1] ?? '';
  const server = key ? await getUserServerByKey(env, getUser(interaction).id, key) : null;
  if (!server) {
    await editDeferred(env, interaction.token, { content, components: [], embeds: [errorEmbed('You no longer have access to that server.')] });
    return;
  }
  try {
    const [status, data] = await pluginExec(server, reqCtx);
    const output = status === 200 ? (data.output ?? '(no output)') : (data.error ?? 'Plugin error');
    await editDeferred(env, interaction.token, {
      content: `**\`${command}\`** on **${server.display_name ?? server.host}**\n\`\`\`\n${output.slice(0, 1800)}\n\`\`\``,
      components: [],
    });
  } catch (e) {
    await editDeferred(env, interaction.token, { content, components: [], embeds: [errorEmbed(String(e))] });
  }
}

export function handleTpsCommand(
  interaction: DiscordInteraction, env: Env, ctx: ExecutionContext, reqCtx: RequestCtx,
): object {
  ctx.waitUntil(runTps(interaction, env, reqCtx));
  return deferPublic();
}

async function runTps(interaction: DiscordInteraction, env: Env, reqCtx: RequestCtx): Promise<void> {
  const server = await getActiveServer(env, getUser(interaction).id);
  if (!server) { await editDeferred(env, interaction.token, { embeds: [noServerEmbed()] }); return; }
  try {
    const [status, data] = await pluginGet<PluginTps>(server, '/tps', reqCtx);
    if (status !== 200) { await editDeferred(env, interaction.token, { embeds: [errorEmbed('Plugin error')] }); return; }
    const { tps_1m: t1, tps_5m: t5, tps_15m: t15 } = data;
    const minTps = Math.min(t1, t5, t15);
    const color = minTps >= 18 ? COLORS.GREEN : minTps >= 14 ? COLORS.YELLOW : COLORS.RED;
    const emoji = (t: number) => t >= 18 ? '🟢' : t >= 14 ? '🟡' : '🔴';
    const speed = (t: number) => `${Math.round(t / 20 * 100)}%`;
    await editDeferred(env, interaction.token, {
      embeds: [{
        title: 'Server TPS', color,
        fields: [
          { name: '1 min',  value: `${emoji(t1)} ${t1.toFixed(1)} [${speed(t1)}]`,    inline: true },
          { name: '5 min',  value: `${emoji(t5)} ${t5.toFixed(1)} [${speed(t5)}]`,    inline: true },
          { name: '15 min', value: `${emoji(t15)} ${t15.toFixed(1)} [${speed(t15)}]`, inline: true },
        ],
        footer: { text: `Normal: 20 TPS = 100% game speed · ${server.host}` },
      }],
    });
  } catch (e) {
    await editDeferred(env, interaction.token, { embeds: [errorEmbed(String(e))] });
  }
}

export function handleListCommand(
  interaction: DiscordInteraction, env: Env, ctx: ExecutionContext, reqCtx: RequestCtx,
): object {
  ctx.waitUntil(runList(interaction, env, reqCtx));
  return deferPublic();
}

async function runList(interaction: DiscordInteraction, env: Env, reqCtx: RequestCtx): Promise<void> {
  const server = await getActiveServer(env, getUser(interaction).id);
  if (!server) { await editDeferred(env, interaction.token, { embeds: [noServerEmbed()] }); return; }
  try {
    const [status, data] = await pluginGet<PluginPlayers>(server, '/players', reqCtx);
    if (status !== 200) { await editDeferred(env, interaction.token, { embeds: [errorEmbed('Plugin error')] }); return; }
    const { online, max, players } = data;
    const description = `**${online} / ${max}** online`
      + (players.length ? '\n\n' + players.map(p => `• ${p}`).join('\n') : '');
    await editDeferred(env, interaction.token, {
      embeds: [{ title: 'Players Online', description, color: online > 0 ? COLORS.GREEN : COLORS.GRAY, footer: { text: server.host } }],
    });
  } catch (e) {
    await editDeferred(env, interaction.token, { embeds: [errorEmbed(String(e))] });
  }
}


function noServerEmbed() {
  return errorEmbed("You don't have access to any Minecraft servers. Run `/servers list` for instructions.");
}
