import { createConnection } from 'node:net';
import { Readable, Writable } from 'node:stream';

// Bundle-time replacement for cloudflare:sockets. Shared protocol code stays identical.
export function connect(address: { hostname: string; port: number }) {
  const socket = createConnection({ host: address.hostname, port: address.port });
  return {
    readable: Readable.toWeb(socket) as ReadableStream<Uint8Array>,
    writable: Writable.toWeb(socket) as WritableStream<Uint8Array>,
    async close() { socket.destroy(); },
  };
}
