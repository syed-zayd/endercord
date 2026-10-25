import { upsertServer } from './db.js';
import { rawRequest } from './plugin.js';
import type { Env } from './types.js';

export async function handleSetup(request: Request, env: Env): Promise<Response> {
  const ip = request.headers.get('CF-Connecting-IP');
  if (!ip) return Response.json({ error: 'could not determine server IP' }, { status: 400 });

  let payload: { secret?: string; port?: number; host?: string; mc_port?: number; server_id?: string; server_name?: string };
  try {
    payload = await request.json() as typeof payload;
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 });
  }

  const { secret, port = 8080, host: connectHost, mc_port, server_id, server_name } = payload;
  if (typeof secret !== 'string' || !/^[0-9a-f]{64}$/i.test(secret))
    return Response.json({ error: 'invalid plugin secret' }, { status: 400 });
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    return Response.json({ error: 'invalid plugin port' }, { status: 400 });

  const pluginUrl = `http://${ip}:${port}`;
  // `host` is the hostname the operator connected with (from the plugin); fall back to IP.
  const host = connectHost?.trim() || ip;
  const mcPort = typeof mc_port === 'number' && mc_port > 0 ? mc_port : 25565;

  // Verify the plugin is reachable by calling back to it over a raw TCP socket
  // (fetch() can't reach bare IPs — see src/plugin.ts).
  try {
    const ping = await rawRequest(ip, port, 'GET', '/ping', { 'X-Secret': secret }, null, 8000);
    if (ping.status < 200 || ping.status >= 300) {
      return Response.json({
        error: `Port check failed: plugin returned HTTP ${ping.status}. Make sure the Endercord plugin is loaded and the secret matches.`,
      }, { status: 400 });
    }
  } catch {
    return Response.json({
      error: `Port ${port} is not reachable at ${ip}. Open it in your firewall and try again.`,
    }, { status: 400 });
  }

  await upsertServer(env, host, pluginUrl, secret, mcPort, server_id?.trim() || null, server_name?.trim() || null);

  // The plugin fetches this application's public key from Discord itself, so it never has to trust ours.
  return Response.json({
    ok: true,
    application_id: env.DISCORD_APP_ID,
    host,
    plugin_url: pluginUrl,
  });
}
