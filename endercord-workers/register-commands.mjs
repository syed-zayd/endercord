if (!process.env.BOT_URL) throw new Error('Set BOT_URL to your deployed Worker HTTPS address before registering commands.');
const base = process.env.BOT_URL.replace(/\/+$/, '');
const response = await fetch(base + '/commands/sync' + (process.argv.includes('--force') ? '?force=1' : ''));
if (!response.ok) throw new Error(`Command registration returned HTTP ${response.status}`);
console.log(await response.text());
