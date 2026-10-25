import { upsertServer } from './db.js';
import { rawRequest } from './plugin.js';
import type { Env } from './types.js';

export async function handleSetup(request: Request, env: Env): Promise<Response> {
  const ip = request.headers.get('CF-Connecting-IP');
  if (!ip) return Response.json({ error: 'could not determine server IP' }, { status: 400 });

  let payload: { secret?: string; port?: number; host?: string; mc_port?: number };
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 });
  }

  const { secret, port = 8080, host: connectHost, mc_port } = payload;
  if (!secret) return Response.json({ error: 'missing secret' }, { status: 400 });

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

  await upsertServer(env, host, pluginUrl, secret, mcPort);

  return Response.json({
    ok: true,
    discord_public_key: env.DISCORD_PUBLIC_KEY,
    host,
    plugin_url: pluginUrl,
  });
}
