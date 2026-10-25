import { COLORS, sendChannelMessage, sendDM } from './discord.js';
import { addUserToServer, getChannelsByServer, getRegisteredUser, getUserByName, getServerBySecret } from './db.js';
import type { Env } from './types.js';

export async function handlePluginEvent(request: Request, env: Env): Promise<Response> {
  const secret = request.headers.get('X-Secret') ?? '';
  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 });
  }

  const type = payload.type as string;

  if (type === 'whitelist_add')    return handleWhitelistAdd(payload, secret, env);
  if (type === 'whitelist_remove') return handleWhitelistRemove(payload, secret, env);

  const server = await getServerBySecret(env, secret);
  if (!server) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const channels = await getChannelsByServer(env, server.id);
  const notifKey = type === 'join' ? 'join_notif' : type === 'leave' ? 'leave_notif' : 'pingguard_notif';

  for (const ch of channels) {
    const state = ch[notifKey as keyof typeof ch] as string;
    if (state === 'off') continue;
    const embed = buildEventEmbed(type, payload, server.host);
    const mention = state === 'ping' ? '@here\n' : '';
    await sendChannelMessage(env, ch.channel_id, { content: mention || undefined, embeds: [embed] });
  }

  return Response.json({ ok: true });
}

function buildEventEmbed(type: string, payload: Record<string, unknown>, host: string) {
  const player = payload.player as string | undefined;
  if (type === 'join')  return { description: `**${player}** joined the server`, color: COLORS.GREEN, footer: { text: host } };
  if (type === 'leave') return { description: `**${player}** left the server`,   color: COLORS.GRAY,  footer: { text: host } };
  // pingguard: PingGuard sends a free-form `message` field
  const message = (payload.message as string | undefined) ?? 'Unknown event';
  return { title: 'PingGuard Alert', description: message, color: COLORS.RED, footer: { text: host } };
}

async function handleWhitelistAdd(payload: Record<string, unknown>, secret: string, env: Env): Promise<Response> {
  const discordUser = String(payload.discord_user ?? '').trim();
  const notify      = payload.notify !== false;

  const server = await getServerBySecret(env, secret);
  if (!server) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const user = discordUser.match(/^\d+$/)
    ? await getRegisteredUser(env, discordUser)
    : await getUserByName(env, discordUser);

  if (!user) {
    return Response.json({
      error: `'${discordUser}' has not registered with this bot. They must run /servers list first.`,
    }, { status: 400 });
  }
  if (!user.allow_ops) {
    return Response.json({ error: `'${discordUser}' has disabled being added to servers via this bot.` }, { status: 403 });
  }

  await addUserToServer(env, user.discord_id, server.id);

  if (notify) {
    await sendDM(env, user.discord_id, {
      embeds: [{
        title: 'Server Access Granted',
        description: `A server operator has granted you access to **${server.host}**.\n\nRun any bot command to use it.`,
        color: COLORS.GREEN,
        footer: { text: 'Run /servers list to see all your servers' },
      }],
    });
  }

  return Response.json({ ok: true, discord_id: user.discord_id });
}

async function handleWhitelistRemove(payload: Record<string, unknown>, secret: string, env: Env): Promise<Response> {
  const discordUser = String(payload.discord_user ?? '').trim();
  const notify      = payload.notify !== false;

  const server = await getServerBySecret(env, secret);
  if (!server) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const user = discordUser.match(/^\d+$/)
    ? await getRegisteredUser(env, discordUser)
    : await getUserByName(env, discordUser);

  if (!user) return Response.json({ error: `'${discordUser}' not found.` }, { status: 404 });

  await import('./db.js').then(m => m.removeUserFromServer(env, user.discord_id, server.id));

  if (notify) {
    await sendDM(env, user.discord_id, {
      embeds: [{
        title: 'Server Access Removed',
        description: `Your access to **${server.host}** has been removed by a server operator.`,
        color: COLORS.RED,
        footer: { text: 'Run /servers list to see your remaining servers' },
      }],
    });
  }

  return Response.json({ ok: true, discord_id: user.discord_id });
}
