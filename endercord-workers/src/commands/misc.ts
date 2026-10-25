import { COLORS, deferEphemeral, deferPublic, editDeferred, errorEmbed, getUser } from '../discord.js';
import { getActiveServer } from '../db.js';
import { pluginExec, pluginGet } from '../plugin.js';
import type { DiscordInteraction, Env, PluginPlayers, PluginTps, RequestCtx } from '../types.js';

export function handleConsoleCommand(
  interaction: DiscordInteraction, env: Env, ctx: ExecutionContext, reqCtx: RequestCtx,
): object {
  const command = interaction.data!.options!.find(o => o.name === 'command')!.value as string;
  ctx.waitUntil(runConsole(interaction, env, command, reqCtx));
  return deferEphemeral();
}

async function runConsole(
  interaction: DiscordInteraction, env: Env, command: string, reqCtx: RequestCtx,
): Promise<void> {
  const server = await getActiveServer(env, getUser(interaction).id);
  if (!server) { await editDeferred(env, interaction.token, { embeds: [noServerEmbed()] }); return; }
  try {
    const [status, data] = await pluginExec(server, command, reqCtx);
    const output = status === 200 ? (data.output ?? '(no output)') : (data.error ?? 'Plugin error');
    await editDeferred(env, interaction.token, {
      content: `**\`${command}\`**\n\`\`\`\n${output.slice(0, 1900)}\n\`\`\``,
    });
  } catch (e) {
    await editDeferred(env, interaction.token, { embeds: [errorEmbed(String(e))] });
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
