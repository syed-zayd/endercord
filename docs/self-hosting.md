# Self-hosting with Docker

The [hosted bot](../README.md) is the easiest option. Follow these steps if you want to run your own. You will create your own Discord application.

## Set up your own bot

**You need:** Paper with Java 25, Docker Compose on the same Linux machine, and a bot subdomain
(e.g. `endercord.example.com`) pointing at it. Ports **80 and 443** must be free and open.
[No domain? Use Cloudflare Workers instead.](cloudflare.md)

### 1. Create a Discord bot

Open the [Discord Developer Portal](https://discord.com/developers/applications) → **New Application**.

- **General Information:** copy the Application ID and Public Key.
- **Bot:** copy/reset the bot token.
- **Installation:** enable Guild Install with `bot` + `applications.commands`. Select View Channels,
  Send Messages, Embed Links and Attach Files, then open the install link to add it to your Discord server.

### 2. Start it

```bash
git clone https://github.com/syed-zayd/endercord.git
cd endercord
cp .env.example .env
chmod 600 .env
nano .env
```

Set `BOT_DOMAIN` to your bot subdomain. Fill in `DISCORD_APP_ID`, `DISCORD_PUBLIC_KEY` and
`BOT_TOKEN` with the values from step 1. Save, then run:

```bash
docker compose up -d --build
```

### 3. Connect Discord

Open `https://YOUR_BOT_DOMAIN/health`. Once it shows `{"ok":true}`, go back to Discord's
**General Information → Interactions Endpoint URL** and save:

```text
https://YOUR_BOT_DOMAIN/interactions
```

### 4. Install the plugin

Download the plugin jar from [Releases](https://github.com/syed-zayd/endercord/releases/latest), or build with Java 25:

```bash
./gradlew build
```

Stop Paper. Copy `endercord-plugin/build/libs/Endercord.jar` into its `plugins/` folder.
Create or edit `plugins/Endercord/config.yml` with your two addresses:

```yaml
bot-url: "https://endercord.example.com"
server-host: "minecraft.example.com"
```

Start Paper. Allow Docker to reach the plugin on TCP **8080**. [Firewall/proxy help →](hosting.md)

### 5. Link and test

In the **Minecraft server console**:

```text
endercord setup
endercord whitelist add YOUR_DISCORD_USERNAME
```

In **Discord**, run `/link` within 30 minutes. Then run `/console say hello` and click **Run**.
Only invite people you trust with full server console access.

---

[Commands](commands.md) · [Troubleshooting & hosting](hosting.md) ·
[Security](security.md) · [Building & releases](development.md) ·
[Cloudflare option](cloudflare.md)

MIT licensed.
