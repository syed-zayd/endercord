package com.zaydsyed.endercord;

import com.google.gson.*;
import com.destroystokyo.paper.profile.PlayerProfile;
import com.sun.net.httpserver.*;
import io.papermc.paper.connection.PlayerLoginConnection;
import io.papermc.paper.event.connection.PlayerConnectionValidateLoginEvent;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.core.LoggerContext;
import org.apache.logging.log4j.core.appender.WriterAppender;
import org.apache.logging.log4j.core.layout.PatternLayout;
import org.bukkit.*;
import org.bukkit.attribute.Attribute;
import org.bukkit.attribute.AttributeInstance;
import org.bukkit.command.*;
import org.bukkit.entity.Player;
import org.bukkit.event.*;
import org.bukkit.event.player.*;
import org.bukkit.inventory.*;
import org.bukkit.plugin.java.JavaPlugin;

import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.PublicKey;
import java.security.SecureRandom;
import java.security.Signature;
import java.security.spec.X509EncodedKeySpec;
import java.sql.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.stream.*;

public class EndercordPlugin extends JavaPlugin implements Listener {

    static final String DEFAULT_BOT_URL = "https://endercord-bot.zaydsyed9.workers.dev";
    private String botEventUrl;
    private String botSetupUrl;

    private final Gson gson = new GsonBuilder().setPrettyPrinting().create();
    private HttpServer httpServer;
    private Connection db;

    private static final String DISCORD_API = "https://discord.com/api/v10";
    private static final long LINK_INVITE_MS = 30 * 60 * 1000;

    private String secret = "";
    private String discordPublicKey = "";
    private String discordAppId = "";
    private String serverId = "";
    private String serverName = "";
    // Discord user ID -> username (empty when added by ID and never linked)
    private final Map<String, String> whitelist = new ConcurrentHashMap<>();
    private File whitelistFile;

    // Lowercased Discord username -> expiry, for /endercord whitelist add <username>.
    // The invite is accepted only by a Discord-signed /link from that exact username.
    private final Map<String, Long> pendingLinks = new ConcurrentHashMap<>();

    // Hostname each online player connected with (the handshake vhost), keyed by UUID.
    // Used by /endercord setup to register the server by the hostname the operator used.
    private final Map<UUID, String> loginHosts = new ConcurrentHashMap<>();

    // ── Lifecycle ─────────────────────────────────────────────────────────

    @Override
    public void onEnable() {
        saveDefaultConfig();

        String botUrl = resolveBotUrl(getConfig().getString("bot-url", ""));
        try {
            URI uri = URI.create(botUrl);
            if (!"https".equals(uri.getScheme()) || uri.getHost() == null || uri.getUserInfo() != null
                    || uri.getQuery() != null || uri.getFragment() != null)
                throw new IllegalArgumentException("expected an HTTPS address without credentials, query or fragment");
        } catch (IllegalArgumentException e) {
            getLogger().severe("Invalid bot-url: " + e.getMessage());
            getServer().getPluginManager().disablePlugin(this);
            return;
        }
        botEventUrl = botUrl + "/event";
        botSetupUrl = botUrl + "/setup";

        secret = getConfig().getString("secret", "");
        if (secret.isEmpty()) {
            secret = generateSecret();
            getConfig().set("secret", secret);
            saveConfig();
            getLogger().info("Generated a new secret. Run /endercord setup to connect to the bot.");
        }

        discordPublicKey = getConfig().getString("discord_public_key", "");
        discordAppId     = getConfig().getString("discord_application_id", "");
        if (discordPublicKey.isEmpty()) {
            getLogger().warning("Discord public key not set. Run /endercord setup before using bot commands.");
        }

        serverId = getConfig().getString("server_id", "");
        if (serverId.isEmpty()) {
            serverId = generateSecret().substring(0, 8);
            getConfig().set("server_id", serverId);
            saveConfig();
        }
        serverName = getConfig().getString("server_name", "").trim();

        getDataFolder().mkdirs();
        whitelistFile = new File(getDataFolder(), "whitelist.json");
        loadWhitelist();

        try {
            openDatabase();
        } catch (SQLException e) {
            getLogger().severe("Failed to open database: " + e.getMessage());
            getServer().getPluginManager().disablePlugin(this);
            return;
        }

        int port = getConfig().getInt("http-port", 8080);
        try {
            startHttpServer(port);
        } catch (IOException e) {
            getLogger().severe("Failed to start HTTP server: " + e.getMessage());
            getServer().getPluginManager().disablePlugin(this);
            return;
        }

        getServer().getPluginManager().registerEvents(this, this);
        getLogger().info("Endercord enabled on port " + port);
    }

    @Override
    public void onDisable() {
        if (httpServer != null) httpServer.stop(0);
        try { if (db != null && !db.isClosed()) db.close(); } catch (SQLException ignored) {}
        getLogger().info("Endercord disabled");
    }

    // ── Commands ──────────────────────────────────────────────────────────

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!sender.hasPermission("endercord.admin")) {
            sender.sendMessage("§cYou must be a server operator to manage Endercord.");
            return true;
        }
        if (args.length == 0) {
            sender.sendMessage("§eUsage:");
            sender.sendMessage("  §f/endercord setup §7— register this server with the bot (run in-game to capture your hostname)");
            sender.sendMessage("  §f/endercord whitelist <add|remove|list|reload> §7— manage Discord users");
            return true;
        }
        switch (args[0].toLowerCase()) {
            case "whitelist": handleWhitelistCommand(sender, args); break;
            case "setup":     handleSetupCommand(sender, args);     break;
            default: sender.sendMessage("§cUnknown subcommand. Use: whitelist, setup");
        }
        return true;
    }

    @Override
    public List<String> onTabComplete(CommandSender sender, Command command, String label, String[] args) {
        if (args.length == 1)
            return Stream.of("whitelist", "setup").filter(s -> s.startsWith(args[0].toLowerCase())).collect(Collectors.toList());
        if (args.length == 2 && args[0].equalsIgnoreCase("whitelist"))
            return Stream.of("add", "remove", "list", "reload").filter(s -> s.startsWith(args[1].toLowerCase())).collect(Collectors.toList());
        if (args.length == 3 && args[0].equalsIgnoreCase("whitelist") &&
            (args[1].equalsIgnoreCase("add") || args[1].equalsIgnoreCase("remove")))
            return getServer().getOnlinePlayers().stream().map(Player::getName)
                .filter(s -> s.toLowerCase().startsWith(args[2].toLowerCase())).collect(Collectors.toList());
        return Collections.emptyList();
    }

    // /endercord whitelist <add|remove|list|reload> [user] [notify]
    private void handleWhitelistCommand(CommandSender sender, String[] args) {
        if (args.length < 2) {
            sender.sendMessage("§eUsage: /endercord whitelist <add|remove|list|reload> [discord_user] [notify]");
            return;
        }
        String sub = args[1].toLowerCase();
        switch (sub) {
            case "list": {
                if (whitelist.isEmpty()) {
                    sender.sendMessage("§eWhitelist is empty. No Discord users have been granted access.");
                } else {
                    sender.sendMessage("§eWhitelisted Discord users (" + whitelist.size() + "):");
                    whitelist.forEach((id, name) -> sender.sendMessage("  §7" + id + (name.isEmpty() ? "" : " §8(" + name + ")")));
                }
                return;
            }
            case "reload": {
                loadWhitelist();
                sender.sendMessage("§aWhitelist reloaded. " + whitelist.size() + " user(s) active.");
                return;
            }
            case "add":
            case "remove": {
                if (args.length < 3) {
                    sender.sendMessage("§eUsage: /endercord whitelist " + sub + " <discord_user> [true|false]");
                    return;
                }
                if (discordPublicKey.isEmpty()) {
                    sender.sendMessage("§cRun /endercord setup first before managing the whitelist.");
                    return;
                }
                String discordUser = args[2].trim();
                boolean notify = args.length < 4 || !args[3].equalsIgnoreCase("false");
                boolean isId = discordUser.matches("\\d{17,20}");

                if (sub.equals("add") && !isId) {
                    pendingLinks.put(discordUser.toLowerCase(), System.currentTimeMillis() + LINK_INVITE_MS);
                    JsonObject invite = new JsonObject();
                    invite.addProperty("type",     "link_invite");
                    invite.addProperty("username", discordUser);
                    invite.addProperty("notify",   notify);
                    sender.sendMessage("§eInvited §b" + discordUser + "§e. They have 30 minutes to run §f/link§e in Discord.");
                    Bukkit.getScheduler().runTaskAsynchronously(this, () -> {
                        try {
                            postJson(botEventUrl, gson.toJson(invite), secret, 5000);
                        } catch (IOException e) {
                            String msg = "§eThe bot could not DM them (" + e.getMessage() + "). Ask them to run /link.";
                            Bukkit.getScheduler().runTask(this, () -> sender.sendMessage(msg));
                        }
                    });
                    return;
                }

                String discordId = isId ? discordUser : idForUsername(discordUser);
                if (discordId == null) {
                    if (pendingLinks.remove(discordUser.toLowerCase()) != null) {
                        sender.sendMessage("§aCancelled the pending invite for §b" + discordUser + "§a.");
                    } else {
                        sender.sendMessage("§c" + discordUser + " is not on the whitelist. Use their Discord user ID if they never linked.");
                    }
                    return;
                }

                if (sub.equals("add")) {
                    whitelist.putIfAbsent(discordId, "");
                } else {
                    whitelist.remove(discordId);
                }
                saveWhitelist();
                sender.sendMessage("§a" + (sub.equals("add") ? "Added §b" : "Removed §b") + discordUser + (sub.equals("add") ? "§a to" : "§a from") + " the whitelist.");

                JsonObject payload = new JsonObject();
                payload.addProperty("type",         sub.equals("add") ? "whitelist_add" : "whitelist_remove");
                payload.addProperty("discord_user", discordId);
                payload.addProperty("notify",       notify);
                Bukkit.getScheduler().runTaskAsynchronously(this, () -> {
                    try {
                        postJson(botEventUrl, gson.toJson(payload), secret, 5000);
                    } catch (IOException e) {
                        String msg = "§eWhitelist updated, but the bot could not update their server list: " + e.getMessage();
                        Bukkit.getScheduler().runTask(this, () -> sender.sendMessage(msg));
                    }
                });
                return;
            }
            default:
                sender.sendMessage("§cUnknown subcommand. Use: add, remove, list, reload");
        }
    }

    // /endercord setup  — registers with the bot, using the hostname the running
    // player connected with (the handshake vhost). Run from console → registers by IP.
    private void handleSetupCommand(CommandSender sender, String[] args) {
        final String connectHost = (sender instanceof Player p) ? loginHosts.get(p.getUniqueId()) : null;
        final boolean usefulHost = isPublicHostname(connectHost);
        String configuredHost = getConfig().getString("server-host", "").trim();

        if (!configuredHost.isEmpty()) {
            sender.sendMessage("§eRegistering with the configured server-host: §b" + configuredHost);
        } else if (!(sender instanceof Player)) {
            sender.sendMessage("§6[Endercord] §eRunning from console — the server will register by its public IP, not a hostname.");
            sender.sendMessage("§7   Run §f/endercord setup§7 in-game (connected via your public domain) to register by hostname.");
        } else if (connectHost == null || connectHost.isBlank()) {
            sender.sendMessage("§6[Endercord] §eCouldn't detect the address you connected with — registering by IP.");
            sender.sendMessage("§7   Reconnect via your public domain and re-run to register by hostname.");
        } else if (!usefulHost) {
            sender.sendMessage("§6[Endercord] §eYou connected via §f" + connectHost + "§e — a local/LAN address or raw IP, not a public hostname.");
            sender.sendMessage("§7   Registering by IP. Connect via your public domain and re-run so players see a proper address.");
        }

        final String hostToSend = !configuredHost.isEmpty() ? configuredHost
                : (usefulHost && connectHost != null) ? connectHost.trim() : null;

        sender.sendMessage("§eRunning setup, please wait...");

        Bukkit.getScheduler().runTaskAsynchronously(this, () -> {
            try {
                int port = getConfig().getInt("http-port", 8080);
                JsonObject payload = new JsonObject();
                payload.addProperty("type",    "setup");
                payload.addProperty("secret",  secret);
                payload.addProperty("port",    port);
                payload.addProperty("mc_port", getServer().getPort());
                if (hostToSend != null)
                    payload.addProperty("host", hostToSend);
                if (serverName.isEmpty())
                    serverName = hostToSend != null ? hostToSend : "Minecraft server";
                payload.addProperty("server_id",   serverId);
                payload.addProperty("server_name", serverName);

                String resp = postJson(botSetupUrl, gson.toJson(payload), null, 10000);

                String appId     = extractJsonField(resp, "application_id");
                String regHost   = extractJsonField(resp, "host");
                String pluginUrl = extractJsonField(resp, "plugin_url");
                if (!appId.matches("\\d{17,20}")) throw new IOException("the bot did not return a Discord application ID");

                // The verification key comes from Discord, never from the bot.
                String pubKey = extractJsonField(getJson(DISCORD_API + "/applications/" + appId + "/rpc", 10000), "verify_key");
                if (!pubKey.matches("[0-9a-f]{64}")) throw new IOException("Discord did not return a public key for application " + appId);

                getConfig().set("discord_application_id", appId);
                getConfig().set("discord_public_key", pubKey);
                getConfig().set("server_name", serverName);
                saveConfig();
                discordAppId = appId;
                discordPublicKey = pubKey;

                Bukkit.getScheduler().runTask(this, () -> {
                    sender.sendMessage("§a§lSetup complete!");
                    sender.sendMessage("§eServer registered as: §b" + regHost);
                    sender.sendMessage("§ePlugin URL: §7" + pluginUrl);
                    sender.sendMessage("§eConsole confirmations will name this server §b" + serverName + " §7(" + serverId + ")");
                    sender.sendMessage("§eDiscord public key fetched from Discord for application §7" + appId);
                    sender.sendMessage("§eNext: §f/endercord whitelist add <discord_username>");
                });
            } catch (IOException e) {
                String msg = "§cSetup failed: " + e.getMessage();
                Bukkit.getScheduler().runTask(this, () -> sender.sendMessage(msg));
            }
        });
    }

    // A "useful" public hostname for display: a real domain name — not localhost,
    // a LAN/loopback address, or a raw IP literal (those don't help players find the
    // server and shouldn't be registered as the hostname).
    private boolean isPublicHostname(String h) {
        if (h == null) return false;
        String s = h.trim().toLowerCase();
        if (s.isEmpty() || s.equals("localhost")) return false;
        if (s.contains(":")) return false;                        // IPv6 literal
        if (s.matches("\\d{1,3}(\\.\\d{1,3}){3}")) return false;   // IPv4 literal (public or private)
        return true;                                              // treat as a domain name
    }

    // ── HTTP server ───────────────────────────────────────────────────────

    @FunctionalInterface
    interface Handler { void handle(HttpExchange ex) throws Exception; }

    private void startHttpServer(int port) throws IOException {
        httpServer = HttpServer.create(new InetSocketAddress("0.0.0.0", port), 0);
        // /ping: lightweight health check used during setup — only requires X-Secret
        httpServer.createContext("/ping",      ex -> authenticated(ex, this::handlePing));
        // All other endpoints: require X-Secret + valid Discord signature + whitelisted user
        httpServer.createContext("/tps",       ex -> secured(ex, this::handleTps));
        httpServer.createContext("/players",   ex -> secured(ex, this::handlePlayers));
        httpServer.createContext("/player/",   ex -> secured(ex, this::handlePlayer));
        httpServer.createContext("/sessions/", ex -> secured(ex, this::handleSessions));
        httpServer.createContext("/exec",      ex -> secured(ex, this::handleExec));
        // /link: X-Secret + valid Discord signature, from a user with a pending invite
        httpServer.createContext("/link",      ex -> signed(ex, this::handleLink));
        httpServer.setExecutor(Executors.newCachedThreadPool());
        httpServer.start();
    }

    // Checks only X-Secret (used for /ping during setup, before public key is known)
    private void authenticated(HttpExchange ex, Handler h) throws IOException {
        if (!secret.equals(ex.getRequestHeaders().getFirst("X-Secret"))) {
            respond(ex, 401, "{\"error\":\"unauthorized\"}");
            return;
        }
        try {
            h.handle(ex);
        } catch (Exception e) {
            getLogger().warning("HTTP handler error: " + e.getMessage());
            try { respond(ex, 500, "{\"error\":\"internal error\"}"); } catch (IOException ignored) {}
        }
    }

    // Checks X-Secret + Discord Ed25519 signature + whitelist membership.
    // This ensures every request genuinely came from a whitelisted Discord user —
    // even the bot operator cannot forge a request without a valid Discord signature.
    private void secured(HttpExchange ex, Handler h) throws IOException {
        signed(ex, e -> {
            String userId = discordUserId((JsonObject) e.getAttribute("discord"));
            if (userId == null || !whitelist.containsKey(userId)) {
                respond(e, 403, "{\"error\":\"discord user not whitelisted\"}");
                return;
            }
            h.handle(e);
        });
    }

    // Checks X-Secret + a fresh Discord Ed25519 signature for this server's Discord application,
    // then hands the verified interaction to the handler as the "discord" exchange attribute.
    private void signed(HttpExchange ex, Handler h) throws IOException {
        if (!secret.equals(ex.getRequestHeaders().getFirst("X-Secret"))) {
            respond(ex, 401, "{\"error\":\"unauthorized\"}");
            return;
        }

        String sigHex    = ex.getRequestHeaders().getFirst("X-Discord-Signature");
        String timestamp = ex.getRequestHeaders().getFirst("X-Discord-Timestamp");
        String b64Body   = ex.getRequestHeaders().getFirst("X-Discord-Body");

        if (sigHex == null || timestamp == null || b64Body == null) {
            respond(ex, 401, "{\"error\":\"missing discord verification headers\"}");
            return;
        }

        if (discordPublicKey.isEmpty()) {
            respond(ex, 503, "{\"error\":\"not configured — run /endercord setup\"}");
            return;
        }

        String body;
        try {
            body = new String(Base64.getDecoder().decode(b64Body), StandardCharsets.UTF_8);
        } catch (Exception e) {
            respond(ex, 400, "{\"error\":\"invalid body encoding\"}");
            return;
        }

        try {
            long ts = Long.parseLong(timestamp);
            if (Math.abs(System.currentTimeMillis() / 1000 - ts) > 300) {
                respond(ex, 401, "{\"error\":\"signature expired\"}");
                return;
            }
        } catch (NumberFormatException e) {
            respond(ex, 400, "{\"error\":\"invalid timestamp\"}");
            return;
        }

        if (!verifyDiscordSignature(discordPublicKey, timestamp, body, sigHex)) {
            respond(ex, 401, "{\"error\":\"invalid discord signature\"}");
            return;
        }

        JsonObject interaction;
        try {
            interaction = JsonParser.parseString(body).getAsJsonObject();
        } catch (Exception e) {
            respond(ex, 400, "{\"error\":\"invalid interaction\"}");
            return;
        }
        if (!discordAppId.isEmpty() && !discordAppId.equals(stringAt(interaction, "application_id"))) {
            respond(ex, 401, "{\"error\":\"interaction is for a different discord application\"}");
            return;
        }
        ex.setAttribute("discord", interaction);

        try {
            h.handle(ex);
        } catch (Exception e) {
            getLogger().warning("HTTP handler error: " + e.getMessage());
            try { respond(ex, 500, "{\"error\":\"internal error\"}"); } catch (IOException ignored) {}
        }
    }

    private void respond(HttpExchange ex, int status, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        ex.getResponseHeaders().set("Content-Type", "application/json");
        ex.sendResponseHeaders(status, bytes.length);
        try (OutputStream os = ex.getResponseBody()) { os.write(bytes); }
    }

    // ── Endpoint handlers ─────────────────────────────────────────────────

    private void handlePing(HttpExchange ex) throws Exception {
        respond(ex, 200, "{\"ok\":true}");
    }

    private void handleTps(HttpExchange ex) throws Exception {
        double[] tps = getServer().getTPS();
        JsonObject obj = new JsonObject();
        obj.addProperty("tps_1m",  tps[0]);
        obj.addProperty("tps_5m",  tps[1]);
        obj.addProperty("tps_15m", tps[2]);
        respond(ex, 200, gson.toJson(obj));
    }

    private void handlePlayers(HttpExchange ex) throws Exception {
        Collection<? extends Player> online = getServer().getOnlinePlayers();
        JsonObject obj = new JsonObject();
        obj.addProperty("online", online.size());
        obj.addProperty("max",    getServer().getMaxPlayers());
        JsonArray arr = new JsonArray();
        for (Player p : online) arr.add(p.getName());
        obj.add("players", arr);
        respond(ex, 200, gson.toJson(obj));
    }

    private void handlePlayer(HttpExchange ex) throws Exception {
        String path = ex.getRequestURI().getPath();
        String name = path.substring(path.lastIndexOf('/') + 1);

        Player online = getServer().getPlayerExact(name);
        if (online != null) {
            respond(ex, 200, gson.toJson(serializePlayer(online, true)));
            return;
        }

        UUID uuid;
        try { uuid = resolveUuid(name); } catch (SQLException e) { uuid = null; }
        if (uuid == null) { respond(ex, 404, "{\"error\":\"player not found\"}"); return; }

        String canonical = resolveCanonicalName(name, uuid);
        JsonObject data = loadOfflinePlayer(uuid, canonical);
        if (data == null) { respond(ex, 404, "{\"error\":\"no data for player\"}"); return; }
        respond(ex, 200, gson.toJson(data));
    }

    private void handleSessions(HttpExchange ex) throws Exception {
        String path = ex.getRequestURI().getPath();
        String name = path.substring(path.lastIndexOf('/') + 1);
        int count = parseCount(ex.getRequestURI().getQuery(), 5);

        UUID uuid;
        try { uuid = resolveUuid(name); } catch (SQLException e) { uuid = null; }
        if (uuid == null) { respond(ex, 404, "{\"error\":\"player not found\"}"); return; }

        JsonObject obj = new JsonObject();
        obj.add("sessions", querySessions(uuid.toString(), count));
        respond(ex, 200, gson.toJson(obj));
    }

    private void handleExec(HttpExchange ex) throws Exception {
        if (!ex.getRequestMethod().equalsIgnoreCase("POST")) {
            respond(ex, 405, "{\"error\":\"method not allowed\"}");
            return;
        }
        // Run only a command the user confirmed for this server: a Discord-signed click on
        // "Run" under a message that names this server, so the bot cannot redirect or alter it.
        JsonObject interaction = (JsonObject) ex.getAttribute("discord");
        String command = confirmedConsoleCommand(interaction, serverName, serverId);
        if (command == null) {
            respond(ex, 403, "{\"error\":\"not a signed Run confirmation for this server\"}");
            return;
        }
        if (!claimInteraction(stringAt(interaction, "id"))) {
            respond(ex, 409, "{\"error\":\"this confirmation was already used\"}");
            return;
        }

        StringWriter sw = new StringWriter();
        LoggerContext logCtx = (LoggerContext) LogManager.getContext(false);
        WriterAppender appender = WriterAppender.newBuilder()
            .setName("EndercordCapture")
            .setTarget(sw)
            .setLayout(PatternLayout.newBuilder().withPattern("%msg%n").build())
            .build();
        appender.start();
        logCtx.getRootLogger().addAppender(appender);

        try {
            Future<Boolean> future = Bukkit.getScheduler().callSyncMethod(this,
                () -> Bukkit.dispatchCommand(Bukkit.getConsoleSender(), command));
            future.get(5, TimeUnit.SECONDS);
        } catch (ExecutionException | TimeoutException e) {
            logCtx.getRootLogger().removeAppender(appender);
            appender.stop();
            String msg = (e.getMessage() != null ? e.getMessage() : "timeout");
            respond(ex, 500, "{\"error\":\"" + jsonEscape(msg) + "\"}");
            return;
        } finally {
            logCtx.getRootLogger().removeAppender(appender);
            appender.stop();
        }

        String output = sw.toString()
            .replaceAll("\\[[0-9;]*m", "")
            .replaceAll("§.", "")
            .lines()
            .filter(l -> !l.startsWith("Issued server command") && !l.isBlank())
            .collect(Collectors.joining("\n"))
            .trim();
        if (output.isEmpty()) output = "(no output)";
        respond(ex, 200, "{\"output\":\"" + jsonEscape(output) + "\"}");
    }

    // ── Events ────────────────────────────────────────────────────────────

    // Capture the hostname (handshake vhost) the player connected with, e.g.
    // "play.example.com" or a raw IP, keyed by UUID. Uses the modern connection event
    // (PlayerLoginEvent is deprecated since 1.21.6).
    @EventHandler
    public void onValidateLogin(PlayerConnectionValidateLoginEvent e) {
        if (!(e.getConnection() instanceof PlayerLoginConnection conn)) return;
        InetSocketAddress vhost = conn.getVirtualHost();
        PlayerProfile profile = conn.getAuthenticatedProfile();
        if (profile == null) profile = conn.getUnsafeProfile();
        if (vhost != null && vhost.getHostString() != null && !vhost.getHostString().isBlank()
                && profile != null && profile.getId() != null) {
            loginHosts.put(profile.getId(), vhost.getHostString());
        }
    }

    @EventHandler
    public void onJoin(PlayerJoinEvent e) {
        Player p = e.getPlayer();
        try { insertSession(p); } catch (SQLException ex) {
            getLogger().warning("DB error on join: " + ex.getMessage());
        }
        pushEvent(buildEvent("join", p, null));
    }

    @EventHandler
    public void onQuit(PlayerQuitEvent e) {
        Player p = e.getPlayer();
        loginHosts.remove(p.getUniqueId());
        long duration = -1;
        try { duration = closeSession(p); } catch (SQLException ex) {
            getLogger().warning("DB error on quit: " + ex.getMessage());
        }
        pushEvent(buildEvent("leave", p, duration >= 0 ? duration : null));
    }

    private JsonObject buildEvent(String type, Player p, Long durationSeconds) {
        JsonObject obj = new JsonObject();
        obj.addProperty("type",   type);
        obj.addProperty("player", p.getName());
        if (durationSeconds != null) obj.addProperty("duration_seconds", durationSeconds);
        return obj;
    }

    private void pushEvent(JsonObject payload) {
        String json = gson.toJson(payload);
        Bukkit.getScheduler().runTaskAsynchronously(this, () -> {
            try {
                postJson(botEventUrl, json, secret, 3000);
            } catch (Exception e) {
                getLogger().warning("Failed to push event: " + e.getMessage());
            }
        });
    }

    // ── Player serialization ──────────────────────────────────────────────

    private JsonObject serializePlayer(Player p, boolean online) {
        JsonObject obj = new JsonObject();
        obj.addProperty("name",        p.getName());
        obj.addProperty("uuid",        p.getUniqueId().toString());
        obj.addProperty("online",      online);
        obj.addProperty("health",      p.getHealth());
        AttributeInstance maxHealth = p.getAttribute(Attribute.MAX_HEALTH);
        obj.addProperty("max_health",  maxHealth != null ? maxHealth.getValue() : 20.0);
        obj.addProperty("food",        p.getFoodLevel());
        obj.addProperty("xp_level",    p.getLevel());
        obj.addProperty("xp_progress", p.getExp());
        obj.addProperty("xp_total",    p.getTotalExperience());
        obj.addProperty("gamemode",    p.getGameMode().name());

        PlayerInventory pi = p.getInventory();
        JsonObject inv = new JsonObject();
        inv.add("armor",   serializeArmor(pi.getArmorContents()));
        inv.add("hotbar",  serializeSlots(pi.getContents(), 0, 9));
        inv.add("main",    serializeSlots(pi.getContents(), 9, 36));
        ItemStack offhand = pi.getItemInOffHand();
        inv.add("offhand", offhand.getType() == Material.AIR ? JsonNull.INSTANCE : serializeItem(offhand));
        obj.add("inventory", inv);

        JsonArray ec = new JsonArray();
        ItemStack[] ecContents = p.getEnderChest().getContents();
        for (int i = 0; i < ecContents.length; i++) {
            if (ecContents[i] != null && ecContents[i].getType() != Material.AIR) {
                JsonObject slot = new JsonObject();
                slot.addProperty("slot", i);
                slot.add("item", serializeItem(ecContents[i]));
                ec.add(slot);
            }
        }
        obj.add("ender_chest", ec);
        return obj;
    }

    private JsonArray serializeSlots(ItemStack[] contents, int from, int to) {
        JsonArray arr = new JsonArray();
        for (int i = from; i < to && i < contents.length; i++) {
            ItemStack item = contents[i];
            if (item != null && item.getType() != Material.AIR) {
                JsonObject slot = new JsonObject();
                slot.addProperty("slot", i - from);
                slot.add("item", serializeItem(item));
                arr.add(slot);
            }
        }
        return arr;
    }

    private JsonObject serializeArmor(ItemStack[] armor) {
        String[] keys = {"boots", "leggings", "chestplate", "helmet"};
        JsonObject obj = new JsonObject();
        for (int i = 0; i < armor.length && i < keys.length; i++)
            obj.add(keys[i], armor[i] != null && armor[i].getType() != Material.AIR
                ? serializeItem(armor[i]) : JsonNull.INSTANCE);
        return obj;
    }

    private JsonObject serializeItem(ItemStack item) {
        JsonObject obj = new JsonObject();
        obj.addProperty("id",    item.getType().getKey().toString());
        obj.addProperty("count", item.getAmount());
        return obj;
    }

    private JsonObject loadOfflinePlayer(UUID uuid, String name) {
        File dataFile = new File(getServer().getWorldContainer(), "world/playerdata/" + uuid + ".dat");
        if (!dataFile.exists()) return null;
        JsonObject obj = new JsonObject();
        obj.addProperty("name",        name);
        obj.addProperty("uuid",        uuid.toString());
        obj.addProperty("online",      false);
        obj.addProperty("health",      0.0);
        obj.addProperty("max_health",  20.0);
        obj.addProperty("food",        0);
        obj.addProperty("xp_level",    0);
        obj.addProperty("xp_progress", 0.0);
        obj.addProperty("xp_total",    0);
        obj.addProperty("gamemode",    "SURVIVAL");
        obj.add("inventory",   new JsonObject());
        obj.add("ender_chest", new JsonArray());
        return obj;
    }

    // ── Database ──────────────────────────────────────────────────────────

    private void openDatabase() throws SQLException {
        File dbFile = new File(getDataFolder(), "data.db");
        db = DriverManager.getConnection("jdbc:sqlite:" + dbFile.getAbsolutePath());
        db.createStatement().execute(
            "CREATE TABLE IF NOT EXISTS sessions (" +
            "  id INTEGER PRIMARY KEY AUTOINCREMENT," +
            "  uuid TEXT NOT NULL," +
            "  name TEXT NOT NULL," +
            "  joined_at INTEGER NOT NULL," +
            "  left_at INTEGER" +
            ")"
        );
        db.createStatement().execute(
            "CREATE TABLE IF NOT EXISTS used_interactions (" +
            "  id TEXT PRIMARY KEY," +
            "  used_at INTEGER NOT NULL" +
            ")"
        );
        db.createStatement().execute(
            "CREATE TABLE IF NOT EXISTS usercache (" +
            "  uuid TEXT PRIMARY KEY," +
            "  name TEXT NOT NULL" +
            ")"
        );
    }

    private void insertSession(Player p) throws SQLException {
        PreparedStatement st = db.prepareStatement(
            "INSERT INTO sessions (uuid, name, joined_at) VALUES (?, ?, ?)");
        st.setString(1, p.getUniqueId().toString());
        st.setString(2, p.getName());
        st.setLong(3,   System.currentTimeMillis() / 1000);
        st.executeUpdate();

        PreparedStatement uc = db.prepareStatement(
            "INSERT INTO usercache (uuid, name) VALUES (?, ?) ON CONFLICT(uuid) DO UPDATE SET name = excluded.name");
        uc.setString(1, p.getUniqueId().toString());
        uc.setString(2, p.getName());
        uc.executeUpdate();
    }

    private long closeSession(Player p) throws SQLException {
        long now = System.currentTimeMillis() / 1000;
        PreparedStatement st = db.prepareStatement(
            "UPDATE sessions SET left_at = ? WHERE uuid = ? AND left_at IS NULL");
        st.setLong(1, now);
        st.setString(2, p.getUniqueId().toString());
        st.executeUpdate();

        PreparedStatement q = db.prepareStatement(
            "SELECT joined_at FROM sessions WHERE uuid = ? AND left_at = ? ORDER BY id DESC LIMIT 1");
        q.setString(1, p.getUniqueId().toString());
        q.setLong(2, now);
        ResultSet rs = q.executeQuery();
        return rs.next() ? now - rs.getLong("joined_at") : -1;
    }

    private JsonArray querySessions(String uuid, int count) throws SQLException {
        PreparedStatement st = db.prepareStatement(
            "SELECT joined_at, left_at FROM sessions WHERE uuid = ? ORDER BY id DESC LIMIT ?");
        st.setString(1, uuid);
        st.setInt(2, count);
        ResultSet rs = st.executeQuery();
        JsonArray arr = new JsonArray();
        while (rs.next()) {
            JsonObject s = new JsonObject();
            s.addProperty("joined_at", rs.getLong("joined_at"));
            long left = rs.getLong("left_at");
            if (rs.wasNull()) s.add("left_at", JsonNull.INSTANCE);
            else s.addProperty("left_at", left);
            arr.add(s);
        }
        return arr;
    }

    private UUID resolveUuid(String name) throws SQLException {
        PreparedStatement st = db.prepareStatement(
            "SELECT uuid FROM usercache WHERE LOWER(name) = LOWER(?) LIMIT 1");
        st.setString(1, name);
        ResultSet rs = st.executeQuery();
        return rs.next() ? UUID.fromString(rs.getString("uuid")) : null;
    }

    private String resolveCanonicalName(String fallback, UUID uuid) throws SQLException {
        PreparedStatement st = db.prepareStatement(
            "SELECT name FROM usercache WHERE uuid = ? LIMIT 1");
        st.setString(1, uuid.toString());
        ResultSet rs = st.executeQuery();
        return rs.next() ? rs.getString("name") : fallback;
    }

    // ── Whitelist storage ─────────────────────────────────────────────────

    private void loadWhitelist() {
        whitelist.clear();
        if (!whitelistFile.exists()) return;
        try (Reader r = new InputStreamReader(new FileInputStream(whitelistFile), StandardCharsets.UTF_8)) {
            JsonElement root = JsonParser.parseReader(r);
            if (root.isJsonArray()) {
                for (JsonElement el : root.getAsJsonArray()) whitelist.put(el.getAsString(), "");
            } else {
                for (Map.Entry<String, JsonElement> e : root.getAsJsonObject().entrySet())
                    whitelist.put(e.getKey(), e.getValue().getAsString());
            }
            getLogger().info("Loaded " + whitelist.size() + " whitelisted Discord user(s).");
        } catch (Exception e) {
            getLogger().warning("Failed to load whitelist.json: " + e.getMessage());
        }
    }

    private void saveWhitelist() {
        JsonObject obj = new JsonObject();
        whitelist.forEach(obj::addProperty);
        try (Writer w = new OutputStreamWriter(new FileOutputStream(whitelistFile), StandardCharsets.UTF_8)) {
            new GsonBuilder().setPrettyPrinting().create().toJson(obj, w);
        } catch (Exception e) {
            getLogger().warning("Failed to save whitelist.json: " + e.getMessage());
        }
    }

    // ── Ed25519 verification ──────────────────────────────────────────────

    // Verifies Discord's Ed25519 signature independently of the bot operator.
    // Trust root is Discord, not the bot. Anyone can audit this in the open-source plugin.
    static boolean verifyDiscordSignature(String discordPublicKey, String timestamp, String body, String sigHex) {
        try {
            byte[] rawKey = hexToBytes(discordPublicKey);
            // Wrap raw Ed25519 key bytes into X.509 SubjectPublicKeyInfo format (required by Java)
            byte[] prefix = {0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00};
            byte[] x509Key = new byte[prefix.length + rawKey.length];
            System.arraycopy(prefix,  0, x509Key, 0,             prefix.length);
            System.arraycopy(rawKey,  0, x509Key, prefix.length, rawKey.length);

            PublicKey pubKey = KeyFactory.getInstance("Ed25519")
                .generatePublic(new X509EncodedKeySpec(x509Key));

            Signature sig = Signature.getInstance("Ed25519");
            sig.initVerify(pubKey);
            sig.update((timestamp + body).getBytes(StandardCharsets.UTF_8));
            return sig.verify(hexToBytes(sigHex));
        } catch (Exception e) {
            return false;
        }
    }

    // The confirmation the bot must show before a console command runs. The plugin rebuilds it from
    // its own name and ID, so a confirmation shown for another server never matches this one.
    static String confirmationText(String command, String serverName, String serverId) {
        return "Run `" + command + "` on **" + serverName + "** (`" + serverId + "`)?";
    }

    // Returns the command from a signed click on a button labelled "Run" whose message is exactly
    // this server's confirmation, or null for anything else.
    static String confirmedConsoleCommand(JsonObject interaction, String serverName, String serverId) {
        try {
            if (interaction.get("type").getAsInt() != 3) return null;
            JsonObject data = interaction.getAsJsonObject("data");
            if (data.get("component_type").getAsInt() != 2) return null;
            String clicked = data.get("custom_id").getAsString();

            JsonObject message = interaction.getAsJsonObject("message");
            String label = null;
            for (JsonElement row : message.getAsJsonArray("components"))
                for (JsonElement c : row.getAsJsonObject().getAsJsonArray("components")) {
                    JsonObject button = c.getAsJsonObject();
                    if (clicked.equals(stringAt(button, "custom_id"))) label = stringAt(button, "label");
                }
            if (!"Run".equals(label)) return null;
            if (message.has("embeds") && !message.getAsJsonArray("embeds").isEmpty()) return null;

            String content = message.get("content").getAsString();
            String prefix = "Run `";
            String suffix = confirmationText("", serverName, serverId).substring(prefix.length());
            if (!content.startsWith(prefix) || !content.endsWith(suffix)) return null;
            String command = content.substring(prefix.length(), content.length() - suffix.length());
            if (command.isBlank() || command.contains("`") || command.contains("\n")) return null;
            return confirmationText(command, serverName, serverId).equals(content) ? command : null;
        } catch (Exception e) {
            return null;
        }
    }

    // Records an interaction ID so the same signed request can only be acted on once.
    private synchronized boolean claimInteraction(String id) throws SQLException {
        if (id == null || id.isEmpty()) return false;
        long now = System.currentTimeMillis() / 1000;
        try (PreparedStatement prune = db.prepareStatement("DELETE FROM used_interactions WHERE used_at < ?")) {
            prune.setLong(1, now - 600);
            prune.executeUpdate();
        }
        try (PreparedStatement st = db.prepareStatement("INSERT OR IGNORE INTO used_interactions (id, used_at) VALUES (?, ?)")) {
            st.setString(1, id);
            st.setLong(2, now);
            return st.executeUpdate() == 1;
        }
    }

    // /link: whitelists the signed user if their Discord username has a pending invite.
    private void handleLink(HttpExchange ex) throws Exception {
        JsonObject interaction = (JsonObject) ex.getAttribute("discord");
        boolean isLink = interaction.get("type").getAsInt() == 2
            && "link".equals(stringAt(interaction.getAsJsonObject("data"), "name"));
        JsonObject user = discordUser(interaction);
        String id = user == null ? null : stringAt(user, "id");
        String username = user == null ? null : stringAt(user, "username");
        if (!isLink || id == null || username == null) {
            respond(ex, 403, "{\"error\":\"not a signed /link interaction\"}");
            return;
        }

        Long expiry = pendingLinks.get(username.toLowerCase());
        if (expiry == null || expiry < System.currentTimeMillis()) {
            pendingLinks.remove(username.toLowerCase());
            respond(ex, 403, "{\"error\":\"no pending invite for this user\"}");
            return;
        }
        if (!claimInteraction(stringAt(interaction, "id"))) {
            respond(ex, 409, "{\"error\":\"this /link was already used\"}");
            return;
        }

        pendingLinks.remove(username.toLowerCase());
        whitelist.put(id, username);
        saveWhitelist();
        getLogger().info("Linked Discord user " + username + " (" + id + ") and added them to the whitelist.");
        respond(ex, 200, "{\"ok\":true,\"discord_id\":\"" + id + "\"}");
    }

    private String idForUsername(String username) {
        for (Map.Entry<String, String> e : whitelist.entrySet())
            if (e.getValue().equalsIgnoreCase(username)) return e.getKey();
        return null;
    }

    private static String stringAt(JsonObject obj, String key) {
        if (obj == null || !obj.has(key) || obj.get(key).isJsonNull()) return null;
        return obj.get(key).getAsString();
    }

    private static JsonObject discordUser(JsonObject interaction) {
        JsonElement member = interaction.get("member");
        if (member != null && member.isJsonObject() && member.getAsJsonObject().has("user"))
            return member.getAsJsonObject().getAsJsonObject("user");
        JsonElement user = interaction.get("user");
        return user != null && user.isJsonObject() ? user.getAsJsonObject() : null;
    }

    private static String discordUserId(JsonObject interaction) {
        return interaction == null ? null : stringAt(discordUser(interaction), "id");
    }

    private static byte[] hexToBytes(String hex) {
        byte[] data = new byte[hex.length() / 2];
        for (int i = 0; i < hex.length(); i += 2)
            data[i / 2] = (byte) ((Character.digit(hex.charAt(i), 16) << 4)
                                +  Character.digit(hex.charAt(i + 1), 16));
        return data;
    }

    // ── Utilities ─────────────────────────────────────────────────────────

    static String resolveBotUrl(String configured) {
        String url = configured == null ? "" : configured.trim().replaceAll("/+$", "");
        return url.isEmpty() ? DEFAULT_BOT_URL : url;
    }

    private String generateSecret() {
        byte[] bytes = new byte[32];
        new SecureRandom().nextBytes(bytes);
        StringBuilder sb = new StringBuilder();
        for (byte b : bytes) sb.append(String.format("%02x", b));
        return sb.toString();
    }

    // Posts JSON and returns the response body. Throws IOException with the error message on non-2xx.
    private String postJson(String url, String json, String xSecret, int timeoutMs) throws IOException {
        HttpURLConnection conn = (HttpURLConnection) URI.create(url).toURL().openConnection();
        conn.setRequestMethod("POST");
        conn.setRequestProperty("Content-Type", "application/json");
        if (xSecret != null) conn.setRequestProperty("X-Secret", xSecret);
        conn.setConnectTimeout(timeoutMs);
        conn.setReadTimeout(timeoutMs);
        conn.setDoOutput(true);
        byte[] body = json.getBytes(StandardCharsets.UTF_8);
        conn.setRequestProperty("Content-Length", String.valueOf(body.length));
        try (OutputStream os = conn.getOutputStream()) { os.write(body); }

        int code = conn.getResponseCode();
        InputStream is = code < 400 ? conn.getInputStream() : conn.getErrorStream();
        String responseBody = is != null ? new String(is.readAllBytes(), StandardCharsets.UTF_8) : "";
        conn.disconnect();

        if (code >= 400) {
            String error = extractJsonField(responseBody, "error");
            throw new IOException(error.isEmpty() ? "HTTP " + code : error);
        }
        return responseBody;
    }

    private String getJson(String url, int timeoutMs) throws IOException {
        HttpURLConnection conn = (HttpURLConnection) URI.create(url).toURL().openConnection();
        conn.setConnectTimeout(timeoutMs);
        conn.setReadTimeout(timeoutMs);
        int code = conn.getResponseCode();
        InputStream is = code < 400 ? conn.getInputStream() : conn.getErrorStream();
        String body = is != null ? new String(is.readAllBytes(), StandardCharsets.UTF_8) : "";
        conn.disconnect();
        if (code >= 400) throw new IOException("HTTP " + code + " from " + url);
        return body;
    }

    private int parseCount(String query, int def) {
        if (query == null) return def;
        for (String part : query.split("&")) {
            if (part.startsWith("count=")) {
                try { return Integer.parseInt(part.substring(6)); } catch (NumberFormatException ignored) {}
            }
        }
        return def;
    }

    private String extractJsonField(String json, String field) {
        String search = "\"" + field + "\"";
        int idx = json.indexOf(search);
        if (idx < 0) return "";
        idx = json.indexOf(":", idx) + 1;
        while (idx < json.length() && json.charAt(idx) == ' ') idx++;
        if (idx >= json.length()) return "";
        if (json.charAt(idx) == '"') {
            int end = json.indexOf('"', idx + 1);
            return end < 0 ? "" : json.substring(idx + 1, end);
        }
        int end = idx;
        while (end < json.length() && json.charAt(end) != ',' && json.charAt(end) != '}') end++;
        return json.substring(idx, end).trim();
    }

    private String jsonEscape(String s) {
        return s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "");
    }

}
