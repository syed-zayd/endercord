import { connect } from 'cloudflare:sockets';

// Minecraft Server List Ping (SLP), modern JSON protocol (1.7+).
// Reaches the server over a raw TCP socket (Workers connect()), sends a
// handshake + status request, and parses the status JSON response.

export interface McStatus {
  online: number | null;
  max: number | null;
  versionName: string | null;
  motd: string;
  faviconDataUri: string | null;
}

// VarInt encoder (Minecraft protocol). Handles negative values (e.g. -1) as 32-bit.
function varInt(value: number): number[] {
  const out: number[] = [];
  let v = value | 0;
  for (;;) {
    if ((v & ~0x7f) === 0) { out.push(v & 0xff); return out; }
    out.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
}

// Flatten a chat-component MOTD (string | { text, extra[] }) into plain text.
function flatten(c: unknown): string {
  if (c == null) return '';
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map(flatten).join('');
  const o = c as { text?: string; extra?: unknown };
  let s = typeof o.text === 'string' ? o.text : '';
  if (Array.isArray(o.extra)) s += o.extra.map(flatten).join('');
  return s;
}

// `handshakeAddr` is the "server address" sent in the handshake. We put the Endercord
// secret here so PingGuard can recognize the bot and serve the real MOTD/icon (its
// Cloudflare egress IP isn't fixed, so IP whitelisting won't work). Non-PingGuard
// servers ignore this field, so a normal ping still works.
export async function pingMinecraft(
  host: string, port: number, handshakeAddr: string, timeoutMs: number,
): Promise<McStatus> {
  const socket = connect({ hostname: host, port });

  let timeout: ReturnType<typeof setTimeout>;
  const timer = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`mc ping timed out after ${timeoutMs}ms`)), timeoutMs);
  });

  const run = (async (): Promise<McStatus> => {
    const addr = new TextEncoder().encode(handshakeAddr);

    // Handshake packet (id 0x00): protocol(-1) + addr + port + nextState(1=status)
    const body: number[] = [
      0x00,
      ...varInt(-1),
      ...varInt(addr.length), ...addr,
      (port >> 8) & 0xff, port & 0xff,
      ...varInt(1),
    ];
    const handshake = new Uint8Array([...varInt(body.length), ...body]);
    const statusRequest = new Uint8Array([0x01, 0x00]); // len=1, packet id=0x00

    const writer = socket.writable.getWriter();
    await writer.write(handshake);
    await writer.write(statusRequest);
    writer.releaseLock();

    // Incremental reader over the socket
    const reader = socket.readable.getReader();
    let buf = new Uint8Array(0);
    let pos = 0;
    const pull = async (): Promise<void> => {
      const { value, done } = await reader.read();
      if (done) throw new Error('connection closed early');
      const merged = new Uint8Array(buf.length - pos + value.length);
      merged.set(buf.subarray(pos));
      merged.set(value, buf.length - pos);
      buf = merged; pos = 0;
    };
    const need = async (n: number): Promise<void> => { while (buf.length - pos < n) await pull(); };
    const readByte = async (): Promise<number> => { await need(1); return buf[pos++]; };
    const readVarInt = async (): Promise<number> => {
      let num = 0, shift = 0, b: number;
      do { b = await readByte(); num |= (b & 0x7f) << shift; shift += 7; } while (b & 0x80);
      return num >>> 0;
    };

    await readVarInt();             // outer packet length (unused)
    await readVarInt();             // packet id (expect 0x00)
    const jsonLen = await readVarInt();
    await need(jsonLen);
    const json = JSON.parse(new TextDecoder().decode(buf.subarray(pos, pos + jsonLen))) as {
      version?: { name?: string };
      players?: { online?: number; max?: number };
      description?: unknown;
      favicon?: string;
    };

    return {
      online: json.players?.online ?? null,
      max: json.players?.max ?? null,
      versionName: json.version?.name ?? null,
      motd: flatten(json.description).replace(/§./g, '').trim(),
      faviconDataUri: typeof json.favicon === 'string' ? json.favicon : null,
    };
  })();

  try {
    return await Promise.race([run, timer]);
  } finally {
    clearTimeout(timeout!);
    try { await socket.close(); } catch { /* already closed */ }
  }
}
