// Build-time alias in build-node.mjs supplies the Node implementation.
declare module 'cloudflare:sockets' {
  export function connect(address: { hostname: string; port: number }): {
    readable: import('node:stream/web').ReadableStream<Uint8Array>;
    writable: import('node:stream/web').WritableStream<Uint8Array>;
    close(): Promise<void>;
  };
}
