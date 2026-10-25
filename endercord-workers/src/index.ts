import { verifyDiscordRequest } from './verify.js';
import { handlePluginEvent } from './events.js';
import { handleSetup } from './setup.js';
import { syncCommands } from './register.js';
import { handleServersCommand, handleServersSwitch, handleServersRemove } from './commands/servers.js';
import { handlePlayerCommand, handlePlayerButton } from './commands/player.js';
import { handleConsoleButton, handleConsoleCommand, handleTpsCommand, handleListCommand } from './commands/misc.js';
import { handleServerInfoCommand } from './commands/serverinfo.js';
import { handleCaptureProof } from './commands/captureproof.js';
import { handleNotifsCommand, handleSetNotifsCommand, handleNotifSelect } from './commands/notifs.js';
import { handleLinkCommand } from './commands/link.js';
import type { DiscordInteraction, Env, RequestCtx } from './types.js';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname === '/event' && request.method === 'POST') {
      return handlePluginEvent(request, env);
    }

    if (pathname === '/setup' && request.method === 'POST') {
      return handleSetup(request, env);
    }

    // Registers slash commands with Discord using the Worker's own BOT_TOKEN.
    // Hash-gated: only calls Discord when the command set changed (?force=1 overrides).
    // Called automatically by `npm run deploy`.
    if (pathname === '/commands/sync') {
      const force = new URL(request.url).searchParams.get('force') === '1';
      const result = await syncCommands(env, force);
      return Response.json(result, { status: result.ok ? 200 : 502 });
    }

    if (pathname === '/interactions' && request.method === 'POST') {
      const rawBody  = await request.text();
      const signature = request.headers.get('X-Signature-Ed25519') ?? '';
      const timestamp = request.headers.get('X-Signature-Timestamp') ?? '';

      const valid = await verifyDiscordRequest(rawBody, signature, timestamp, env.DISCORD_PUBLIC_KEY);
      if (!valid) return new Response('Unauthorized', { status: 401 });

      const interaction = JSON.parse(rawBody) as DiscordInteraction;
      const reqCtx: RequestCtx = { rawBody, signature, timestamp };

      if (interaction.type === 1) return Response.json({ type: 1 });
      if (interaction.type === 2) return Response.json(await routeCommand(interaction, env, ctx, reqCtx));
      if (interaction.type === 3) return Response.json(await routeComponent(interaction, env, ctx, reqCtx));

      return new Response('Unknown interaction type', { status: 400 });
    }

    return new Response('Not found', { status: 404 });
  },
};

async function routeCommand(
  interaction: DiscordInteraction, env: Env, ctx: ExecutionContext, reqCtx: RequestCtx,
): Promise<object> {
  // Message context-menu command (type 3) — DEMO: Discord-signed message proof
  if (interaction.data!.type === 3) return handleCaptureProof(interaction, env, ctx, reqCtx);

  switch (interaction.data!.name) {
    case 'servers':   return handleServersCommand(interaction, env);
    case 'player':    return handlePlayerCommand(interaction, env, ctx, reqCtx);
    case 'console':   return handleConsoleCommand(interaction, env);
    case 'link':      return handleLinkCommand(interaction, env, ctx, reqCtx);
    case 'tps':       return handleTpsCommand(interaction, env, ctx, reqCtx);
    case 'list':      return handleListCommand(interaction, env, ctx, reqCtx);
    case 'serverinfo': return handleServerInfoCommand(interaction, env, ctx);
    case 'notifs':    return handleNotifsCommand(interaction, env);
    case 'setnotifs': return handleSetNotifsCommand(interaction, env);
    default:          return { type: 4, data: { content: 'Unknown command.', flags: 64 } };
  }
}

async function routeComponent(
  interaction: DiscordInteraction, env: Env, ctx: ExecutionContext, reqCtx: RequestCtx,
): Promise<object> {
  const id = interaction.data!.custom_id!;
  if (id.startsWith('player_btn:'))  return handlePlayerButton(interaction, env, ctx, reqCtx);
  if (id === 'console_run' || id === 'console_cancel') return handleConsoleButton(interaction, env, ctx, reqCtx);
  if (id === 'servers_switch')       return handleServersSwitch(interaction, env);
  if (id === 'servers_remove')       return handleServersRemove(interaction, env);
  if (id.startsWith('notif:'))       return handleNotifSelect(interaction, env);
  return { type: 4, data: { content: 'Unknown component.', flags: 64 } };
}
