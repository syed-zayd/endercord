import { connect } from 'cloudflare:sockets';
import type { RequestCtx, Server } from './types.js';

const ENC = new TextEncoder();
const DEC = new TextDecoder();

// Encodes the raw Discord body as base64 so it's safe in an HTTP header
function toBase64(str: string): string {
  const bytes = ENC.encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export interface RawResponse {
  status: number;
  body: string;
}

// Low-level HTTP/1.1 over a raw TCP socket.
//
// We use connect() instead of fetch() because Workers' fetch() refuses to
// connect to bare IP addresses (Cloudflare "error code: 1003" — Direct IP
// Access Not Allowed). The plugin is reached by IP (from CF-Connecting-IP at
// setup time), so fetch() can never work; connect() allows any public IP.
//
// The plugin always replies with a fixed Content-Length body (no chunked
// encoding), and we send `Connection: close`, so reading until the socket
// closes yields exactly one complete response.
export async function rawRequest(
  host: string,
  port: number,
  method: 'GET' | 'POST',
  path: string,
  headers: Record<string, string>,
  body: string | null,
  timeoutMs: number,
): Promise<RawResponse> {
  const socket = connect({ hostname: host, port });

  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`plugin request timed out after ${timeoutMs}ms`)), timeoutMs),
  );

  const exchange = (async (): Promise<RawResponse> => {
    const bodyBytes = body != null ? ENC.encode(body) : null;
    const lines = [
      `${method} ${path} HTTP/1.1`,
      `Host: ${host}:${port}`,
      'Connection: close',
      ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`),
    ];
    if (bodyBytes) lines.push(`Content-Length: ${bodyBytes.length}`);

    const writer = socket.writable.getWriter();
    await writer.write(ENC.encode(lines.join('\r\n') + '\r\n\r\n'));
    if (bodyBytes) await writer.write(bodyBytes);
    writer.releaseLock();

    const reader = socket.readable.getReader();
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }

    let total = 0;
    for (const c of chunks) total += c.length;
    const buf = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { buf.set(c, off); off += c.length; }
    const text = DEC.decode(buf);

    const sep = text.indexOf('\r\n\r\n');
    const headPart = sep >= 0 ? text.slice(0, sep) : text;
    const respBody = sep >= 0 ? text.slice(sep + 4) : '';
    const status = parseInt(headPart.split('\r\n', 1)[0].split(' ')[1] ?? '0', 10) || 0;
    return { status, body: respBody };
  })();

  try {
    return await Promise.race([exchange, timeout]);
  } finally {
    try { await socket.close(); } catch { /* already closed */ }
  }
}

function hostPort(server: Server): { host: string; port: number } {
  const url = new URL(server.plugin_url);
  return { host: url.hostname, port: Number(url.port) || 80 };
}

function baseHeaders(server: Server): Record<string, string> {
  return { 'X-Secret': server.secret, 'Content-Type': 'application/json' };
}

function withSignature(server: Server, ctx: RequestCtx): Record<string, string> {
  return {
    ...baseHeaders(server),
    'X-Discord-Signature': ctx.signature,
    'X-Discord-Timestamp': ctx.timestamp,
    'X-Discord-Body': toBase64(ctx.rawBody),
  };
}

function parseJson<T>(body: string): T {
  try { return JSON.parse(body) as T; } catch { return {} as T; }
}

export async function pluginGet<T>(
  server: Server, path: string, ctx: RequestCtx,
): Promise<[number, T]> {
  const { host, port } = hostPort(server);
  const resp = await rawRequest(host, port, 'GET', path, withSignature(server, ctx), null, 5000);
  return [resp.status, parseJson<T>(resp.body)];
}

// ctx must be the signed click on a /console confirmation; the plugin reads the command from it.
export async function pluginExec(
  server: Server, ctx: RequestCtx,
): Promise<[number, { output?: string; error?: string }]> {
  const { host, port } = hostPort(server);
  const resp = await rawRequest(host, port, 'POST', '/exec', withSignature(server, ctx), '{}', 10000);
  return [resp.status, parseJson(resp.body)];
}

export async function pluginPost<T>(
  server: Server, path: string, body: object, ctx: RequestCtx,
): Promise<[number, T]> {
  const { host, port } = hostPort(server);
  const resp = await rawRequest(host, port, 'POST', path, withSignature(server, ctx), JSON.stringify(body), 5000);
  return [resp.status, parseJson<T>(resp.body)];
}
