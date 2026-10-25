# Endercord

A bridge between a Minecraft server and Discord. A Paper plugin runs on the server; a Discord bot,
running as a Cloudflare Worker, lets whitelisted Discord users check on the server and run console
commands from Discord, and posts join, leave and PingGuard alerts to channels.

- `endercord-plugin/` is the Paper plugin (Java 25, Paper 26.1).
- `endercord-workers/` is the Discord bot (TypeScript, Cloudflare Workers + D1).

PingGuard is a separate plugin and repository; Endercord only relays its alerts.

## What it does

| Command | |
| --- | --- |
| `/servers list` · `switch` · `remove` | See the servers you have access to and pick the active one |
| `/servers allowadds` · `denyadds` | Allow or block operators adding you to their server |
| `/player overview` · `inventory` · `echest` · `logins` | A player's stats, equipment, inventory, ender chest and recent sessions |
| `/console <command>` | Run a console command on the active server |
| `/tps`, `/list`, `/serverinfo` | TPS, online players, and live status (MOTD, version, icon) |
| `/notifs`, `/setnotifs` | Choose which channels get join, leave and PingGuard alerts |

## How requests are trusted

The plugin does not have to trust the bot. Every request the bot sends to the plugin carries the
original Discord interaction and Discord's Ed25519 signature for it, and the plugin checks that:

1. the server's shared secret is present,
2. the signature is valid for the bot's Discord public key and less than five minutes old,
3. the Discord user who sent the interaction is on the plugin's own whitelist.

`/console` runs only the command inside that signed interaction, so the bot cannot run anything a
whitelisted user did not type.

## Running a server with Endercord

1. Build the plugin (below) and put `Endercord.jar` in the server's `plugins/` folder.
2. Open the plugin's HTTP port (`http-port` in `plugins/Endercord/config.yml`, default `8080`) so the
   bot can reach it. A random secret is generated on first start.
3. In game, connected through your server's public hostname, run `/endercord setup`. The server
   registers itself with the bot and stores the bot's Discord public key.
4. Give Discord users access with `/endercord whitelist add <discord_user>`. They must have run
   `/servers list` in Discord once first. `list`, `remove` and `reload` manage the whitelist.

## Building

```bash
./gradlew build    # endercord-plugin/build/libs/Endercord.jar
```

Gradle downloads a Java 25 toolchain if one is not installed.

## Hosting the bot yourself

The plugin points at the hosted bot (`BOT_EVENT_URL` and `BOT_SETUP_URL` in
`EndercordPlugin.java`). To run your own:

```bash
cd endercord-workers
npm install
npx wrangler d1 create endercord          # put the database_id in wrangler.toml
npx wrangler d1 execute endercord --remote --file schema.sql
npx wrangler secret put BOT_TOKEN
npx wrangler secret put DISCORD_PUBLIC_KEY
npm run deploy
```

Set `DISCORD_APP_ID` in `wrangler.toml`, point the Discord application's interactions endpoint at
`https://<your-worker>/interactions`, and update the worker URL in `package.json` and the plugin.
