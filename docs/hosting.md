# Hosting and troubleshooting

The [README](../README.md) covers the default: Docker beside Paper on the same Linux machine.

## Network requirements

Point your bot subdomain's DNS at the Docker machine. TCP ports 80 and 443 must be unused and
open in the host and hosting provider firewalls. Any IPv6 DNS record must work too.
Caddy obtains and renews the HTTPS certificate automatically.

The bot must reach the plugin on TCP 8080. On the same machine, allow the Docker bridge network
through the Minecraft host's firewall; this port does not need to be public.

For a separate Minecraft machine, set `PLUGIN_HOST` in `.env` to its reachable hostname or IP
and allow connections from the bot machine in the host/provider firewalls. If you change the
plugin's `http-port`, set `PLUGIN_PORT` in `.env` to match. Recreate the bot after changing `.env`:

```bash
docker compose up -d
```

Docker setup callbacks are restricted to the configured Minecraft host and port.
The provided HTTPS proxy needs a public hostname. If you do not have one, the
[Workers option](cloudflare.md) provides a `workers.dev` address instead.

## Discord installation details

In the [Developer Portal](https://discord.com/developers/applications), select your application:

- **General Information:** copy the Application ID and Public Key.
- **Bot:** create/reset the token and copy it into `.env`. Keep it private.
- **Installation:** enable Guild Install, with `bot` and `applications.commands` scopes.
  Select View Channels, Send Messages, Embed Links and Attach Files permissions.
  Open the generated installation link to add the bot to your Discord server.
- No privileged gateway intents are needed. The bot receives interactions over HTTPS and may
  appear offline in Discord even while its commands work.
- After the container is healthy, set General Information → Interactions Endpoint URL to
  `https://YOUR_BOT_DOMAIN/interactions`. Discord verifies it when you save.

## Plugin configuration

Set `bot-url` to the bot's HTTPS address, without `/interactions`. An empty value disables the
plugin with a configuration message. `server-host` is the Minecraft address shown in Discord;
it lets setup use that hostname from the server console. Without it, setup uses the hostname
you connected with in game, or the public IP when run from the console.

If `config.yml` already exists, edit these settings and keep the generated secret, server ID and
Discord key fields. Restart Paper after editing. The plugin defaults to `http-port: 8080`.

Only operators, or users explicitly granted `endercord.admin` by a permissions plugin, can run
Minecraft's `/endercord` commands. Whitelisted Discord users have full console access.

## Add a Discord user by ID

The user first runs `/servers list` to register with the bot. Then an operator runs:

```text
endercord whitelist add <Discord user ID>
```

This grants access directly; `/link` is not needed. Enable Discord's Developer Mode and
right-click a user → Copy User ID to get the ID.

## Keeping it running

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

## Using an existing reverse proxy

Use the provided override so Caddy does not compete for ports 80/443:

```bash
docker compose -f compose.yaml -f compose.existing-proxy.yaml up -d --build bot
```

Configure your existing HTTPS proxy to forward the bot hostname to `127.0.0.1:3000`. The override
sets `TRUST_PROXY=false`; setup uses the operator-configured `PLUGIN_HOST`, so it does not need
to trust forwarded client IP headers. Preserve the body and Discord signature headers unchanged.

## Troubleshooting

- **Bot will not start:** check the application ID, public key and token, then read `docker compose logs bot`.
- **HTTPS/Discord endpoint will not save:** verify DNS, ports 80/443 and the public key. Check `docker compose logs https`.
- **Setup says the port is unreachable:** check `PLUGIN_HOST`, the plugin's `http-port`, and the host/provider firewalls.
- **No pending invite:** check the exact Discord username, reissue the invite, and run `/link` within 30 minutes.
  Pending plugin invites expire on restart too.
- **No active server:** run `/servers list` and `/servers switch` in Discord.
- **An ordinary player can manage Endercord:** remove any explicit `endercord.admin` grant from your permissions plugin.
