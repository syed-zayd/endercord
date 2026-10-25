import { COLORS, deferEphemeral, editDeferred, getUser } from '../discord.js';
import { addUserToServer, getPendingLinkServers, removePendingLink } from '../db.js';
import { pluginPost } from '../plugin.js';
import type { DiscordInteraction, Env, RequestCtx } from '../types.js';

// /link accepts every pending invite for the user's Discord username. Each plugin checks Discord's
// signature on this interaction and the username in it before whitelisting the user's ID.
export function handleLinkCommand(
  interaction: DiscordInteraction, env: Env, ctx: ExecutionContext, reqCtx: RequestCtx,
): object {
  ctx.waitUntil(link(interaction, env, reqCtx));
  return deferEphemeral();
}

async function link(interaction: DiscordInteraction, env: Env, reqCtx: RequestCtx): Promise<void> {
  const user = getUser(interaction);
  const servers = await getPendingLinkServers(env, user.username);
  if (!servers.length) {
    await editDeferred(env, interaction.token, {
      content: 'You have no pending invites. Ask a server operator to run `/endercord whitelist add ' + user.username + '`, then run `/link` within 30 minutes.',
    });
    return;
  }

  const lines: string[] = [];
  for (const server of servers) {
    const name = server.display_name ?? server.host;
    try {
      const [status, data] = await pluginPost<{ error?: string }>(server, '/link', {}, reqCtx);
      if (status === 200) {
        await addUserToServer(env, user.id, server.id);
        await removePendingLink(env, server.id, user.username);
        lines.push(`✅ **${name}**`);
      } else {
        lines.push(`❌ **${name}**: ${data.error ?? 'HTTP ' + status}`);
      }
    } catch (e) {
      lines.push(`❌ **${name}**: ${String(e)}`);
    }
  }

  await editDeferred(env, interaction.token, {
    embeds: [{ title: 'Linked', description: lines.join('\n'), color: COLORS.GREEN, footer: { text: 'Run /servers list to see your servers' } }],
  });
}
