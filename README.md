# Endercord

Run your Minecraft server from Discord without trusting the Discord bot.

Endercord is a Paper plugin and a Discord bot. Check players and TPS, inspect inventories,
run console commands after confirmation, and send join/leave alerts to Discord. The plugin
verifies Discord's signatures before granting access or running commands.

**You run your own bot.** Docker Compose runs it with SQLite storage and Caddy for automatic
HTTPS. No shared Endercord service, Cloudflare account or paid Discord subscription is required.
You still need a Discord application, a machine that stays online, and a domain or subdomain.

- `endercord-plugin/`: Java 25 / Paper plugin. Built against Paper 26.1.2; tested live on 26.3.
- `endercord-workers/`: shared TypeScript bot, with Docker/Node and Cloudflare Workers runtimes.
- PingGuard is separate; Endercord can relay its alerts but does not require it.

## Quick start: Docker

The default Compose setup runs beside your Minecraft server on the **same Linux machine**.
It needs Docker with Compose, a public hostname such as `endercord.example.com`, and unused
TCP ports **80 and 443**. Point the hostname's DNS at that machine and allow these ports in both
its firewall and your hosting provider's firewall. If it has an IPv6 DNS record, that address
must work too. If you already run a web server on these ports, see [an existing reverse proxy](#using-an-existing-reverse-proxy).

### 1. Create your Discord bot

Open the [Discord Developer Portal](https://discord.com/developers/applications) and create an application.

- From **General Information**, copy its **Application ID** and **Public Key**.
- From **Bot**, create/reset its token and copy it. Keep this token private.
- Under **Installation**, enable **Guild Install**, with the `bot` and `applications.commands`
  scopes. Give it View Channels, Send Messages, Embed Links and Attach Files permissions.
  Open the generated installation link to add it to your Discord server.
- No privileged gateway intents are needed.

### 2. Start the container

```bash
git clone https://github.com/syed-zayd/endercord.git
cd endercord
cp .env.example .env
chmod 600 .env
```

Edit `.env` with your hostname and the three values from Discord:

```dotenv
BOT_DOMAIN=endercord.example.com
DISCORD_APP_ID=your_application_id
DISCORD_PUBLIC_KEY=your_public_key
BOT_TOKEN=your_bot_token
PLUGIN_HOST=host.docker.internal
PLUGIN_PORT=8080
```

Then run:

```bash
docker compose up -d --build
docker compose logs --tail=50
```

The bot registers its slash commands at startup. Caddy obtains and renews the HTTPS certificate.
Once `https://endercord.example.com/health` returns `{"ok":true}`, set the application's
**Interactions Endpoint URL** in Discord's General Information to:

```text
https://endercord.example.com/interactions
```

Discord verifies the endpoint when you save it. Slash commands may take a little time to appear.

### 3. Install the Minecraft plugin

Use **Java 25** to build and run the plugin. With Java installed:

```bash
./gradlew build
# Windows: gradlew.bat build
```

Copy `endercord-plugin/build/libs/Endercord.jar` into your Paper server's `plugins/` folder.
CI also attaches this jar to each successful Checks run as an `Endercord` artifact.
Start the server once to create `plugins/Endercord/config.yml`, then stop it and set:

```yaml
bot-url: "https://endercord.example.com"
server-host: "minecraft.example.com"
http-port: 8080
```

Leave the generated `secret`, server ID and Discord key fields alone. Restart the server after
editing the config. An empty `bot-url` disables Endercord with a configuration message.

The bot must reach TCP **8080** on the Minecraft host. On the same machine, allow connections
from Docker's bridge network; you do not need to expose this port to the Internet. For a bot on
a separate machine, set `PLUGIN_HOST` in `.env` to the Minecraft machine's reachable IP or hostname,
allow the port from that machine, and recreate the bot with `docker compose up -d`.
If you change `http-port`, set `PLUGIN_PORT` in `.env` to the same value. Docker setup callbacks
are restricted to that host and port.

### 4. Set up and link

From the Minecraft server console (omit the leading `/`), or in game as an operator:

```text
endercord setup
endercord whitelist add your_discord_username
```

`server-host` lets setup use your Minecraft hostname even from the console. Without it, setup
uses the hostname you connected with in game, or the public IP when run from the console.
Use your Discord **username**, not your display name. Within 30 minutes, run `/link` in Discord.
Then test:

```text
/console say hello
```

Check the server name in the confirmation and click **Run**. The message should appear in the
Minecraft console even if no players are online.

**Adding by ID instead:** the Discord user first runs `/servers list` to register with the bot.
Then run `endercord whitelist add <Discord user ID>`. That grants access directly; `/link` is not needed.

Only operators (or users explicitly granted `endercord.admin` by a permissions plugin) can run
Minecraft's `/endercord` commands. Whitelisted Discord users have full Minecraft console access:
only add people you would trust with the server console.

### Keeping it running

Containers restart automatically. The `bot-data` volume keeps registrations, links and notification
settings across restarts. Back it up along with `.env`, Caddy's volumes, and the Minecraft plugin's
config/data. Keep these backups private: they contain credentials.

To update from this repository:

```bash
git pull
docker compose up -d --build
```

Rebuild/copy the plugin jar and restart Paper when plugin code changes. `docker compose down`
keeps your data; `docker compose down -v` deletes the volumes.

### Using an existing reverse proxy

Use the provided override so Caddy does not compete for ports 80/443:

```bash
docker compose -f compose.yaml -f compose.existing-proxy.yaml up -d --build bot
```

Configure your existing HTTPS proxy to forward the bot hostname to `127.0.0.1:3000`. The override
sets `TRUST_PROXY=false`; setup uses the operator-configured `PLUGIN_HOST`, so it does not need
to trust forwarded client IP headers. Preserve the body and Discord signature headers unchanged.

### Troubleshooting

- **Bot will not start:** check the application ID, public key and token, then read `docker compose logs bot`.
- **HTTPS/Discord endpoint will not save:** verify DNS, ports 80/443 and the public key. Check `docker compose logs https`.
- **Setup says the port is unreachable:** check `PLUGIN_HOST`, the plugin's `http-port`, and the host/provider firewalls.
- **No pending invite:** check the exact Discord username, reissue the invite, and run `/link` within 30 minutes.
  Pending plugin invites expire on restart too.
- **No active server:** run `/servers list` and `/servers switch` in Discord.
- **An ordinary player can manage Endercord:** remove any explicit `endercord.admin` grant from your permissions plugin.

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

## Cloudflare Workers (alternative)

Docker does not require Cloudflare. If you prefer the Workers runtime instead, see
[the Workers deployment guide](docs/cloudflare.md). Both runtimes use the same command and
Discord signature-verification code.

## Development checks

```bash
./gradlew build
cd endercord-workers
npm ci
npm run check
npm test
npm run build:node
```

Node 24 is required for the Docker runtime and bot tests. Gradle can provision a Java 25 toolchain,
but needs an installed Java runtime to start; installing Java 25 covers both.

## Publishing a version

Pushing a `v*` tag runs the release workflow: it builds/tests the plugin, attaches the jar to a
**draft** GitHub release, and builds/tests/pushes an amd64/arm64 bot image to
`ghcr.io/syed-zayd/endercord-bot:<tag>`. Review/publish the draft and set the GHCR package's
visibility to public when you are ready to share it. No release/image is published just by
merging code. Until an image is published, the quick start builds locally from the Dockerfile.

## License

MIT
