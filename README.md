# Endercord

Endercord is a bridge between Discord and your Minecraft server. It lets you check player counts,
view player inventories, run console commands, and more from Discord. Add the bot to your Discord
server and install the Paper plugin to get started.

Server operators whitelist Discord accounts with a plugin command. The plugin verifies commands
using Discord's Ed25519 signatures, so it only runs commands authorized by those accounts—not
just whatever the bot sends. [How it works →](docs/security.md)

## Setup

**Requires Paper 26.1.2+ and Java 25.** Use the hosted bot—no Docker, Discord developer account, or bot hostname needed.

1. **[Add Endercord to Discord](https://discord.com/oauth2/authorize?client_id=1516215903673520188&permissions=52224&scope=bot%20applications.commands).**
2. **[Download Endercord.jar](https://github.com/syed-zayd/endercord/releases/latest/download/Endercord.jar)**, put it in your server's `plugins/` folder, and restart Paper.
3. **Open TCP 8080** in your server and hosting provider's firewalls so the bot can reach the plugin. [Help →](docs/hosting.md#hosted-bot)
4. **In game as an operator**, connected through your public Minecraft address:

   ```text
   /endercord setup
   /endercord whitelist add YOUR_DISCORD_USERNAME
   ```

5. **In Discord**, run `/link` within 30 minutes. Then try `/console say hello` → **Run**.

Only invite people you trust with full console access. The bot can see requests and misreport
results; the signature checks protect command execution. [Security details →](docs/security.md)

Want to run your own bot? [Docker](docs/self-hosting.md) · [Cloudflare Workers](docs/cloudflare.md)

[Commands](docs/commands.md) · [Troubleshooting](docs/hosting.md#troubleshooting) · [Building & releases](docs/development.md)

MIT licensed.
