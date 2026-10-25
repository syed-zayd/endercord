import { createServer, type IncomingMessage } from 'node:http';
import worker from '../src/index.js';
import { syncCommands } from '../src/register.js';
import { SQLiteDatabase } from './database.js';
import type { Env, RequestExecutionContext } from '../src/types.js';

export interface ServerOptions {
  env: Env;
  // Only enable behind a reverse proxy which overwrites X-Forwarded-For.
  trustProxy?: boolean;
  pluginHost?: string;
  reportError?: (error: unknown) => void;
}

function requestIP(req: IncomingMessage, trustProxy: boolean): string {
  const forwarded = req.headers['x-forwarded-for'];
  const peer = trustProxy && typeof forwarded === 'string'
    ? forwarded.split(',').at(-1)!.trim() : req.socket.remoteAddress ?? '';
  return peer.replace(/^::ffff:/, '');
}

export function createBotServer(options: ServerOptions) {
  const report = options.reportError ?? (() => console.error('Bot request failed; check configuration and connectivity.'));
  const pending = new Set<Promise<unknown>>();
  const ctx: RequestExecutionContext = {
    waitUntil(promise: Promise<unknown>) {
      const tracked = promise.catch(report).finally(() => pending.delete(tracked));
      pending.add(tracked);
    },
  };

  const server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url ?? '/', 'http://bot').pathname;
      if (path === '/health' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}');
        return;
      }
      // Command registration is performed at startup, never exposed to anonymous callers.
      if (path === '/commands/sync') { res.writeHead(404).end(); return; }
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 1024 * 1024) { res.writeHead(413).end(); return; }
        chunks.push(Buffer.from(chunk));
      }
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
      }
      // Never accept a client-supplied Cloudflare identity header on the Node server.
      headers.set('CF-Connecting-IP', options.pluginHost || requestIP(req, options.trustProxy === true));
      const method = req.method ?? 'GET';
      const request = new Request(new URL(req.url ?? '/', 'http://bot'), {
        method, headers,
        body: method === 'GET' || method === 'HEAD' ? undefined : Buffer.concat(chunks),
      });
      const response = await worker.fetch(request, options.env, ctx);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      report(error);
      if (!res.headersSent) res.writeHead(500);
      res.end('Internal server error');
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  return { server, async drain() { await Promise.allSettled([...pending]); } };
}

export async function runBot() {
  for (const name of ['BOT_TOKEN', 'DISCORD_APP_ID', 'DISCORD_PUBLIC_KEY']) {
    if (!process.env[name]) throw new Error(`Missing required variable: ${name}`);
  }
  if (!/^\d{17,20}$/.test(process.env.DISCORD_APP_ID!)) throw new Error('Invalid DISCORD_APP_ID');
  if (!/^[0-9a-f]{64}$/i.test(process.env.DISCORD_PUBLIC_KEY!)) throw new Error('Invalid DISCORD_PUBLIC_KEY');
  const database = new SQLiteDatabase(process.env.DATABASE_PATH ?? '/data/endercord.sqlite');
  const env = {
    DB: database,
    BOT_TOKEN: process.env.BOT_TOKEN!,
    DISCORD_APP_ID: process.env.DISCORD_APP_ID!,
    DISCORD_PUBLIC_KEY: process.env.DISCORD_PUBLIC_KEY!,
  };
  const sync = await syncCommands(env);
  if (!sync.ok) { database.close(); throw new Error('Discord command registration failed; check application ID and bot token.'); }
  const bot = createBotServer({ env, trustProxy: process.env.TRUST_PROXY === 'true', pluginHost: process.env.PLUGIN_HOST });
  bot.server.listen(Number(process.env.PORT ?? 3000), '0.0.0.0', () => console.log('Endercord bot listening on port ' + (process.env.PORT ?? 3000)));
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.once(signal, () => {
      bot.server.close(() => { void bot.drain().finally(() => { database.close(); process.exit(0); }); });
    });
  }
}

