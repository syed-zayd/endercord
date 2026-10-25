# Why you don't have to trust the bot

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

A dishonest bot cannot invent an authorized console command or silently send a confirmation to another server. It can still refuse to pass things on,
see what you send and receive, and misreport results: command output, `/tps`, player lookups and
alerts all reach Discord through the bot. Traffic between the bot and the plugin is plain HTTP, so
it is also readable on the network path.
