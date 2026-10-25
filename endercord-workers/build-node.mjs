import { build } from 'esbuild';
const test = process.argv.includes('--test');
await build({
  entryPoints: [test ? 'node/server.test.ts' : 'node/main.ts'],
  outfile: test ? 'dist/server.test.mjs' : 'dist/server.mjs',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  alias: { 'cloudflare:sockets': './node/sockets.ts' },
  loader: { '.sql': 'text' },
});
