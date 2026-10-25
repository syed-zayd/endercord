import type { RequestExecutionContext } from '../types.js';
import { COLORS, deferPublic, editDeferred, editDeferredFile, errorEmbed, getUser } from '../discord.js';
import { getActiveServer } from '../db.js';
import { pingMinecraft } from '../mcping.js';
import type { DiscordEmbed, DiscordInteraction, Env } from '../types.js';

export function handleServerInfoCommand(
  interaction: DiscordInteraction, env: Env, ctx: RequestExecutionContext,
): object {
  ctx.waitUntil(runServerInfo(interaction, env));
  return deferPublic();
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function runServerInfo(interaction: DiscordInteraction, env: Env): Promise<void> {
  const server = await getActiveServer(env, getUser(interaction).id);
  if (!server) {
    await editDeferred(env, interaction.token, {
      embeds: [errorEmbed("You don't have access to any Minecraft servers. Run `/servers list` for instructions.")],
    });
    return;
  }

  const ip = new URL(server.plugin_url).hostname;
  const port = server.mc_port || 25565;
  const hasHostname = !!server.host && server.host !== ip;
  const title = hasHostname ? server.host : 'Minecraft Server';

  // Address lines shown in the embed (hostname only if we actually know one).
  const addr: string[] = [];
  if (hasHostname) addr.push(`**Hostname:** \`${server.host}\``);
  addr.push(`**IP:** \`${ip}${port !== 25565 ? `:${port}` : ''}\``);

  try {
    // Send the server's secret as the handshake address so PingGuard reveals the real
    // MOTD/icon to the bot (see mcping.ts / PingGuard onServerListPing).
    const s = await pingMinecraft(ip, port, server.secret, 6000);
    const embed: DiscordEmbed = {
      title,
      description: [s.motd, addr.join('\n')].filter(Boolean).join('\n\n'),
      color: COLORS.GREEN,
      fields: [
        { name: 'Players', value: `${s.online ?? '?'} / ${s.max ?? '?'}`, inline: true },
        { name: 'Version', value: s.versionName ?? 'Unknown', inline: true },
      ],
    };

    const b64 = s.faviconDataUri?.startsWith('data:image/png;base64,')
      ? s.faviconDataUri.slice('data:image/png;base64,'.length)
      : null;
    if (b64) {
      embed.thumbnail = { url: 'attachment://icon.png' };
      await editDeferredFile(env, interaction.token, { embeds: [embed] },
        { name: 'icon.png', bytes: base64ToBytes(b64), contentType: 'image/png' });
    } else {
      await editDeferred(env, interaction.token, { embeds: [embed] });
    }
  } catch {
    await editDeferred(env, interaction.token, {
      embeds: [{
        title,
        description: `🔴 **Offline** — couldn't reach the server.\n\n${addr.join('\n')}`,
        color: COLORS.RED,
      }],
    });
  }
}
