# EnderCord

EnderCord connects a Minecraft server plugin to a Discord bot.

- `endercord-plugin/` is the Paper server plugin.
- `endercord-workers/` is the Discord bot implemented as a Cloudflare Worker.

Build the plugin with `./gradlew build` (Windows: `gradlew.bat build`). The Discord bot has its own npm and Wrangler configuration in `endercord-workers/`.

PingGuard is a separate plugin and repository.
