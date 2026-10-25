package com.zaydsyed.endercord;

import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.plugin.PluginDescriptionFile;
import org.bukkit.permissions.PermissionDefault;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class AdminPermissionTest {
    @Test
    void commandRegistrationRequiresAnOperatorPermission() throws Exception {
        try (var stream = getClass().getResourceAsStream("/plugin.yml")) {
            assertNotNull(stream);
            var description = new PluginDescriptionFile(stream);
            assertEquals("endercord.admin", description.getCommands().get("endercord").get("permission"));
            var permission = description.getPermissions().stream()
                    .filter(p -> p.getName().equals("endercord.admin")).findFirst().orElseThrow();
            assertEquals(PermissionDefault.OP, permission.getDefault());
        }
    }

    @Test
    void directHandlerCallsCannotBypassThePermissionCheck() {
        var plugin = mock(EndercordPlugin.class, CALLS_REAL_METHODS);
        var sender = mock(CommandSender.class);
        var command = mock(Command.class);
        for (String[] args : new String[][] {
                {"setup"}, {"whitelist", "add", "1022575946806607983"},
                {"whitelist", "remove", "1022575946806607983"}, {"whitelist", "list"}
        }) {
            assertTrue(plugin.onCommand(sender, command, "endercord", args));
        }
        verify(sender, times(4)).sendMessage("§cYou must be a server operator to manage Endercord.");
        verify(sender, times(4)).hasPermission("endercord.admin");
        verifyNoMoreInteractions(sender);
    }

    @Test
    void permittedSendersCanReachTheCommandHandler() {
        var plugin = mock(EndercordPlugin.class, CALLS_REAL_METHODS);
        var sender = mock(CommandSender.class);
        when(sender.hasPermission("endercord.admin")).thenReturn(true);
        assertTrue(plugin.onCommand(sender, mock(Command.class), "endercord", new String[0]));
        verify(sender).sendMessage("§eUsage:");
        verify(sender, never()).sendMessage("§cYou must be a server operator to manage Endercord.");
    }
}
