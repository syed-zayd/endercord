# Endercord

Run your Minecraft server from Discord **without trusting the bot with your console**.
Check players, TPS and inventories, get join/leave alerts, and run commands after confirmation.

The plugin verifies Discord's own signatures. The bot cannot forge your commands or silently
run a confirmation on a different server. [How it works →](docs/security.md)

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
