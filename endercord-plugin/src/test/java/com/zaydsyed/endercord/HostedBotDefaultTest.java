package com.zaydsyed.endercord;

import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import org.bukkit.configuration.file.YamlConfiguration;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class HostedBotDefaultTest {
    @Test
    void freshInstallPointsAtTheHostedBot() throws Exception {
        try (var stream = getClass().getResourceAsStream("/config.yml")) {
            assertNotNull(stream);
            var config = YamlConfiguration.loadConfiguration(new InputStreamReader(stream, StandardCharsets.UTF_8));
            assertEquals(EndercordPlugin.DEFAULT_BOT_URL, config.getString("bot-url"));
        }
    }

    @Test
    void missingOrPreviouslyBlankSettingsUseTheHostedBot() {
        assertEquals(EndercordPlugin.DEFAULT_BOT_URL, EndercordPlugin.resolveBotUrl(null));
        assertEquals(EndercordPlugin.DEFAULT_BOT_URL, EndercordPlugin.resolveBotUrl(""));
        assertEquals(EndercordPlugin.DEFAULT_BOT_URL, EndercordPlugin.resolveBotUrl("  "));
    }

    @Test
    void selfHostedAddressesRemainSupported() {
        assertEquals("https://bot.example.com", EndercordPlugin.resolveBotUrl(" https://bot.example.com/// "));
    }
}
