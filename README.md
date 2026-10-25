# Endercord

Run your Minecraft server from Discord without trusting the Discord bot.

Endercord is a Paper plugin and a Discord bot. Whitelisted Discord users can check on the server,
look up players and run console commands from Discord, and channels can get join, leave and
PingGuard alerts. The plugin verifies every command itself, using Discord's own signatures, so it
only ever runs what a whitelisted person actually asked for, whoever hosts the bot.

- `endercord-plugin/` is the Paper plugin (Java 25, Paper 26.1).
- `endercord-workers/` is the Discord bot (TypeScript on Cloudflare Workers, with D1).

PingGuard is a separate plugin and repository; Endercord only relays its alerts.

## Commands

| In Discord | |
| --- | --- |
| `/console <command>` | Run a console command on your active server, after confirming |
| `/servers list` · `switch` · `remove` | See the servers you can use and pick the active one |
| `/servers allowadds` · `denyadds` | Allow or block server operators inviting you |
| `/link` | Accept invites from servers that whitelisted your username |
| `/player overview` · `inventory` · `echest` · `logins` | A player's stats, gear, inventory, ender chest and recent sessions |
| `/tps`, `/list`, `/serverinfo` | TPS, online players, and live status (MOTD, version, icon) |
| `/notifs`, `/setnotifs` | Choose which channels get join, leave and PingGuard alerts |

| In Minecraft (operators) | |
| --- | --- |
| `/endercord setup` | Register the server with the bot |
| `/endercord whitelist add <username or user ID>` | Give a Discord user access |
| `/endercord whitelist remove <username or user ID>` · `list` · `reload` | Manage access |

## Why you don't have to trust the bot

Discord signs every interaction it sends to an app (Ed25519, over the timestamp and the exact
request body), and only Discord holds the signing key. The bot passes each signed interaction
through to the plugin, and the plugin checks it before doing anything:

1. **The key comes from Discord.** During setup the bot only says which Discord application it is.
   The plugin fetches that application's public key from Discord itself, and checks the
   application ID on every interaction.
2. **The signature is valid and fresh.** Interactions older than five minutes are refused.
3. **The person is whitelisted here.** The whitelist lives in the plugin. Adding someone by user ID
   takes the ID you typed. Adding someone by username creates a 30-minute invite, and the plugin
   adds the user ID only from a signed `/link` sent by that exact username.
4. **Console commands are confirmed for this server.** `/console` never runs anything on its own.
   The bot shows you a private confirmation such as

   > Run `stop` on **mc.example.com** (`a1b2c3d4`)?   **[Run]** **[Cancel]**

   and the plugin runs the command only from Discord's signed click on **Run**, under a message
   that matches its own server name and its own random server ID exactly. A bot that sent your
   command to a different server, or changed it, would be showing you a confirmation the plugin
   rejects.
5. **Each confirmation works once.** The plugin records the interaction IDs it has acted on.

So a dishonest bot cannot make your server run anything. It can still refuse to pass things on,
see what you send and receive, and misreport results: command output, `/tps`, player lookups and
alerts all reach Discord through the bot. Traffic between the bot and the plugin is plain HTTP, so
it is also readable on the network path.

## Running a server with Endercord

1. Build the plugin (below) and put `Endercord.jar` in the server's `plugins/` folder.
2. Open the plugin's HTTP port (`http-port` in `plugins/Endercord/config.yml`, default `8080`) so the
   bot can reach it. A random secret and server ID are generated on first start.
3. In game, connected through your server's public hostname, run `/endercord setup`. The plugin
   registers with the bot and fetches the bot's public key from Discord. Confirmations will name
   the server by that hostname; set `server_name` in the config before setup to choose another.
4. Give people access:
   - `/endercord whitelist add <username>`, then they run `/link` in Discord within 30 minutes, or
   - `/endercord whitelist add <user ID>` (Discord: Settings → Advanced → Developer Mode, then
     right-click the user → Copy User ID).

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

**Upgrading an existing bot:** apply `migrations/0001_confirm_and_link.sql` once
(`npx wrangler d1 execute endercord --remote --file migrations/0001_confirm_and_link.sql`), deploy,
and have each server update the plugin and run `/endercord setup` again. Until it does, `/console`
for that server asks for the update instead of running.

## License

MIT
