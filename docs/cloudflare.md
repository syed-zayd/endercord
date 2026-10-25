# Cloudflare Workers deployment

This is an alternative to Docker. You host the bot in your own Cloudflare account with D1.
Create/install a Discord application as described in the main README first.

1. Install Node and sign in to Cloudflare with `npx wrangler login`.
2. In `endercord-workers/`, run `npm ci` and `npx wrangler d1 create endercord`.
3. Replace `database_id` in `wrangler.toml` with your database ID. Set `DISCORD_APP_ID`
   to your Discord application ID. Choose your own Worker name if desired.
4. Initialize the new database:

   ```bash
   npx wrangler d1 execute endercord --remote --file schema.sql
   npx wrangler secret put BOT_TOKEN
   npx wrangler secret put DISCORD_PUBLIC_KEY
   npx wrangler deploy
   ```

5. Set the Discord application's Interactions Endpoint URL to
   `https://<your-worker>/interactions`. Register commands at
   `https://<your-worker>/commands/sync` (open it once or use `curl -f`).
6. Set the plugin's `bot-url` to `https://<your-worker>`, restart Paper, then run
   `/endercord setup` and whitelist/link as described in the README.

Workers must reach the Minecraft plugin's TCP port (default 8080) over the public Internet.
Open it in the host firewall and hosting provider's firewall. The default Docker
`host.docker.internal` setting does not apply to Workers.

Set `BOT_URL` when using
`npm run deploy` or `npm run register` for your own Worker. Example:

```bash
BOT_URL=https://my-worker.example.workers.dev npm run deploy
```

## Upgrading the original database

For databases created before console confirmations and linking, apply this migration **once**:

```bash
npx wrangler d1 execute endercord --remote --file migrations/0001_confirm_and_link.sql
```

Do not apply it to a fresh database initialized from `schema.sql`: the columns already exist.
Deploy the bot, update each plugin, configure `bot-url`, restart, and rerun `/endercord setup`.
Until setup is repeated, `/console` asks for the plugin update instead of executing commands.

The Docker runtime creates its own SQLite database. Existing Workers/D1 data is not automatically
copied into Docker; set up and link the servers again when switching runtimes.
