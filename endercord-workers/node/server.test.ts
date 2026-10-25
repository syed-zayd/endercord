import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateKeyPairSync, sign } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBotServer } from './server.js';
import { SQLiteDatabase } from './database.js';
import { rawRequest } from '../src/plugin.js';
import { getAllUserServers, getActiveServer, addUserToServer, registerUser, setDefaultServer } from '../src/db.js';
import { syncCommands } from '../src/register.js';
import type { Env } from '../src/types.js';

async function listen(server: Server): Promise<number> {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as { port: number }).port;
}
async function close(server: Server) {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
function environment(db: SQLiteDatabase, key = '0'.repeat(64)): Env {
  return { DB: db, BOT_TOKEN: 'test-token', DISCORD_APP_ID: '1516215903673520188', DISCORD_PUBLIC_KEY: key };
}

test('SQLite persists access/default selections and rolls back a failed batch', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'endercord-'));
  let db = new SQLiteDatabase(join(dir, 'test.sqlite'));
  try {
    let env = environment(db);
    await registerUser(env, '1022575946806607983', 'z.ayd');
    for (const secret of ['one', 'two']) {
      await db.prepare("INSERT INTO servers(host,plugin_url,secret,added_at) VALUES('mc.example.com','http://localhost:8080',?,0)").bind(secret).run();
    }
    await addUserToServer(env, '1022575946806607983', 1);
    await addUserToServer(env, '1022575946806607983', 2);
    await setDefaultServer(env, '1022575946806607983', 2);
    assert.equal((await getActiveServer(env, '1022575946806607983'))?.id, 2);
    await assert.rejects(db.batch([
      db.prepare("UPDATE user_servers SET is_default = 0"),
      db.prepare('INSERT INTO does_not_exist VALUES (1)'),
    ]));
    assert.equal((await getActiveServer(env, '1022575946806607983'))?.id, 2);
    db.close();
    db = new SQLiteDatabase(join(dir, 'test.sqlite'));
    env = environment(db);
    assert.equal((await getAllUserServers(env, '1022575946806607983')).length, 2);
    assert.equal((await getActiveServer(env, '1022575946806607983'))?.id, 2);
    await db.prepare('DELETE FROM servers WHERE id=2').run();
    assert.equal((await getAllUserServers(env, '1022575946806607983')).length, 1);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('HTTP adapter accepts real Ed25519 signatures and rejects modified requests', async () => {
  const keys = generateKeyPairSync('ed25519');
  const publicKey = keys.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('hex');
  const db = new SQLiteDatabase(':memory:');
  const errors: unknown[] = [];
  const bot = createBotServer({ env: environment(db, publicKey), reportError: error => errors.push(error) });
  const port = await listen(bot.server);
  const base = `http://127.0.0.1:${port}`;
  try {
    const body = '{"type":1}';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = sign(null, Buffer.from(timestamp + body), keys.privateKey).toString('hex');
    const headers = { 'X-Signature-Ed25519': signature, 'X-Signature-Timestamp': timestamp };
    const valid = await fetch(base + '/interactions', { method: 'POST', body, headers });
    assert.equal(valid.status, 200);
    assert.deepEqual(await valid.json(), { type: 1 });
    assert.equal((await fetch(base + '/interactions', { method: 'POST', body: '{"type":2}', headers })).status, 401);
    assert.equal((await fetch(base + '/interactions', { method: 'POST', body })).status, 401);
    assert.equal((await fetch(base + '/commands/sync')).status, 404);
    assert.equal((await fetch(base + '/health')).status, 200);
    assert.deepEqual(errors, []);
  } finally { await close(bot.server); await bot.drain(); db.close(); }
});

test('setup calls the plugin, ignores spoofed IP headers, and preserves server identity', async () => {
  const db = new SQLiteDatabase(':memory:');
  let validSecret = false;
  const plugin = createServer((req, res) => {
    validSecret = req.headers['x-secret'] === 'a'.repeat(64);
    const body = validSecret ? '{"ok":true}' : '{}';
    res.writeHead(validSecret ? 200 : 401, { 'Content-Length': Buffer.byteLength(body) }).end(body);
  });
  const pluginPort = await listen(plugin);
  const bot = createBotServer({ env: environment(db), pluginHost: '127.0.0.1', pluginPort });
  const botPort = await listen(bot.server);
  try {
    const result = await fetch(`http://127.0.0.1:${botPort}/setup`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.99', 'X-Forwarded-For': '203.0.113.98' },
      body: JSON.stringify({ secret: 'a'.repeat(64), port: pluginPort, host: 'mc.example.com', server_id: 'abcd1234', server_name: 'My server' }),
    });
    assert.equal(result.status, 200);
    const data = await result.json() as { plugin_url: string };
    assert.equal(data.plugin_url, `http://127.0.0.1:${pluginPort}`);
    assert.equal(validSecret, true);
    const disallowed = await fetch(`http://127.0.0.1:${botPort}/setup`, { method: 'POST', body: JSON.stringify({ secret: 'a'.repeat(64), port: pluginPort === 8080 ? 8081 : 8080 }) });
    assert.equal(disallowed.status, 400);
    const row = await db.prepare('SELECT host,server_key,display_name FROM servers').first();
    assert.deepEqual({ ...row as object }, { host: 'mc.example.com', server_key: 'abcd1234', display_name: 'My server' });
    const bad = await fetch(`http://127.0.0.1:${botPort}/setup`, {
      method: 'POST', body: JSON.stringify({ secret: 'b'.repeat(64), port: pluginPort }),
    });
    assert.equal(bad.status, 400);
    assert.equal((await db.prepare('SELECT id FROM servers').all()).results.length, 1);
  } finally { await close(bot.server); await close(plugin); db.close(); }
});

test('Node TCP transport forwards Discord proofs and UTF-8 without rewriting', async () => {
  let seenBody = '';
  let seenProof = '';
  const plugin = createServer(async (req, res) => {
    seenProof = String(req.headers['x-discord-body']);
    for await (const chunk of req) seenBody += chunk.toString();
    const body = JSON.stringify({ output: 'hello 🌎' });
    res.writeHead(200, { 'Content-Length': Buffer.byteLength(body) }).end(body);
  });
  const port = await listen(plugin);
  try {
    const body = JSON.stringify({ text: 'é' });
    const proof = Buffer.from('{"signed":"✓"}').toString('base64');
    const response = await rawRequest('127.0.0.1', port, 'POST', '/exec', { 'X-Discord-Body': proof }, body, 1000);
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(response.body), { output: 'hello 🌎' });
    assert.equal(seenBody, body);
    assert.equal(seenProof, proof);
  } finally { await close(plugin); }
});

test('command registration is persisted and skipped until definitions change', async () => {
  const db = new SQLiteDatabase(':memory:');
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json([{ name: 'test' }]); };
  try {
    assert.equal((await syncCommands(environment(db))).registered, 1);
    assert.equal((await syncCommands(environment(db))).skipped, true);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = realFetch; db.close(); }
});
