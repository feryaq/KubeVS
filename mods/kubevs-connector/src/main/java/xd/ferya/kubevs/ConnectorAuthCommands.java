package xd.ferya.kubevs;

import static net.minecraft.commands.Commands.argument;
import static net.minecraft.commands.Commands.literal;

import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.builder.LiteralArgumentBuilder;
import java.io.IOException;
import java.util.Arrays;
import java.util.Objects;
import java.util.function.Supplier;
import net.minecraft.ChatFormatting;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.SharedSuggestionProvider;
import net.minecraft.network.chat.ClickEvent;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.HoverEvent;
import net.minecraft.network.chat.MutableComponent;
import net.minecraft.server.level.ServerPlayer;

final class ConnectorAuthCommands {
    private static final int OP_PERMISSION_LEVEL = 2;
    private static final int ADMIN_PERMISSION_LEVEL = 4;
    private static final ChatFormatting BRAND = ChatFormatting.AQUA;
    private static final ChatFormatting LABEL = ChatFormatting.GRAY;
    private static final ChatFormatting VALUE = ChatFormatting.WHITE;
    private static final ChatFormatting SUCCESS = ChatFormatting.GREEN;
    private static final ChatFormatting WARNING = ChatFormatting.GOLD;
    private static final ChatFormatting DANGER = ChatFormatting.RED;
    private static final ChatFormatting MUTED = ChatFormatting.DARK_GRAY;

    private ConnectorAuthCommands() {}

    static void register(
            CommandDispatcher<CommandSourceStack> dispatcher,
            Supplier<ConnectorConfig> configSupplier,
            Supplier<KubeVSSocketServer> serverSupplier) {
        dispatcher.register(command("kubevs", configSupplier, serverSupplier));
        dispatcher.register(command("kvs", configSupplier, serverSupplier));
    }

    private static LiteralArgumentBuilder<CommandSourceStack> command(
            String root,
            Supplier<ConnectorConfig> configSupplier,
            Supplier<KubeVSSocketServer> serverSupplier) {
        return literal(root)
                .requires(source -> source.hasPermission(OP_PERMISSION_LEVEL))
                .executes(context -> showStatus(
                        context.getSource(), configSupplier.get(), serverSupplier.get()))
                .then(literal("join").executes(context -> join(
                        context.getSource(), configSupplier.get(), serverSupplier.get())))
                .then(literal("users")
                        .requires(source -> source.hasPermission(ADMIN_PERMISSION_LEVEL))
                        .executes(context -> showUsers(
                                context.getSource(), configSupplier.get(), serverSupplier.get())))
                .then(literal("role")
                        .requires(source -> source.hasPermission(ADMIN_PERMISSION_LEVEL))
                        .then(argument("player", StringArgumentType.word())
                                .suggests((context, builder) -> SharedSuggestionProvider.suggest(
                                        configSupplier.get().playerTokens().list().stream()
                                                .map(PlayerTokenStore.Account::playerName),
                                        builder))
                                .then(argument("role", StringArgumentType.word())
                                        .suggests((context, builder) ->
                                                SharedSuggestionProvider.suggest(
                                                        Arrays.stream(ConnectorRole.values())
                                                                .map(ConnectorRole::id),
                                                        builder))
                                        .executes(context -> setRole(
                                                context.getSource(),
                                                configSupplier.get(),
                                                serverSupplier.get(),
                                                StringArgumentType.getString(context, "player"),
                                                StringArgumentType.getString(context, "role"))))))
                .then(literal("revoke")
                        .requires(source -> source.hasPermission(ADMIN_PERMISSION_LEVEL))
                        .then(argument("player", StringArgumentType.word())
                                .suggests((context, builder) -> SharedSuggestionProvider.suggest(
                                        configSupplier.get().playerTokens().list().stream()
                                                .map(PlayerTokenStore.Account::playerName),
                                        builder))
                                .executes(context -> revoke(
                                        context.getSource(),
                                        configSupplier.get(),
                                        serverSupplier.get(),
                                        StringArgumentType.getString(context, "player")))))
                .then(literal("auth")
                        .requires(source -> source.hasPermission(ADMIN_PERMISSION_LEVEL))
                        .executes(context -> showStatus(
                                context.getSource(), configSupplier.get(), serverSupplier.get()))
                        .then(literal("copy").executes(context -> showAdminAccess(
                                context.getSource(), configSupplier.get(), serverSupplier.get())))
                        .then(literal("rotate")
                                .executes(context -> requestRotation(context.getSource(), root))
                                .then(literal("confirm").executes(context -> rotateToken(
                                        context.getSource(),
                                        configSupplier.get(),
                                        serverSupplier.get())))));
    }

    private static int showStatus(
            CommandSourceStack source, ConnectorConfig config, KubeVSSocketServer server) {
        if (!isRunning(config, server, source)) return 0;

        source.sendSuccess(
                () -> Component.literal("KubeVS")
                        .withStyle(BRAND, ChatFormatting.BOLD)
                        .append(Component.literal("  CONNECTOR").withStyle(VALUE, ChatFormatting.BOLD))
                        .append(Component.literal("  ONLINE").withStyle(SUCCESS, ChatFormatting.BOLD)),
                false);
        source.sendSuccess(
                () -> Component.literal("Address  ")
                        .withStyle(LABEL)
                        .append(Component.literal(config.publicHost() + ":" + config.publicPort())
                                .withStyle(VALUE))
                        .append(Component.literal("    VS Code clients  ").withStyle(MUTED))
                        .append(Component.literal(Integer.toString(server.connectedClientCount()))
                                .withStyle(server.connectedClientCount() > 0 ? SUCCESS : VALUE)),
                false);

        if (!source.hasPermission(ADMIN_PERMISSION_LEVEL)) {
            source.sendSuccess(
                    () -> Component.literal("Connect VS Code  ")
                            .withStyle(LABEL)
                            .append(commandHint("/kvs join", "Create a personal connection code")),
                    false);
            return 1;
        }

        source.sendSuccess(
                () -> Component.literal("Accounts  ")
                        .withStyle(LABEL)
                        .append(Component.literal(Integer.toString(config.playerTokens().size()))
                                .withStyle(VALUE))
                        .append(Component.literal("    "))
                        .append(actionButton(
                                "[Manage]",
                                BRAND,
                                ClickEvent.Action.RUN_COMMAND,
                                "/kvs users",
                                "Open roles and access")),
                false);
        if (source.getEntity() instanceof ServerPlayer) {
            source.sendSuccess(
                    () -> Component.literal("Administrator  ")
                            .withStyle(LABEL)
                            .append(copyAccessButton(config, server.authenticationToken()))
                            .append(Component.literal("    "))
                            .append(rotateButton()),
                    false);
        } else {
            source.sendSuccess(
                    () -> Component.literal("Admin token  ")
                            .withStyle(LABEL)
                            .append(Component.literal(config.tokenFile().toAbsolutePath().normalize().toString())
                                    .withStyle(VALUE)),
                    false);
        }
        return 1;
    }

    private static int join(
            CommandSourceStack source, ConnectorConfig config, KubeVSSocketServer server) {
        if (!isRunning(config, server, source)) return 0;
        if (!(source.getEntity() instanceof ServerPlayer player)) {
            source.sendFailure(Component.literal(
                    "/kvs join is player-only. From the console, use the admin token stored in "
                            + config.tokenFile()));
            return 0;
        }
        if (!source.hasPermission(config.joinPermissionLevel())) {
            source.sendFailure(Component.literal(
                    "Insufficient permission: command level " + config.joinPermissionLevel()
                            + " is required. Contact a server administrator."));
            return 0;
        }

        try {
            PlayerTokenStore.Credential credential = config.playerTokens().issue(
                    player.getUUID(),
                    player.getGameProfile().getName(),
                    config.defaultJoinRole());
            server.disconnectPlayer(player.getUUID(), "A new KubeVS token was issued");
            source.sendSuccess(
                    () -> Component.literal("KUBEVS ACCESS READY")
                            .withStyle(SUCCESS, ChatFormatting.BOLD),
                    false);
            source.sendSuccess(
                    () -> Component.literal("Account  ")
                            .withStyle(LABEL)
                            .append(Component.literal(credential.playerName()).withStyle(VALUE))
                            .append(Component.literal("    Role  ").withStyle(MUTED))
                            .append(Component.literal(credential.role().displayName())
                                    .withStyle(roleColor(credential.role()), ChatFormatting.BOLD)),
                    false);
            source.sendSuccess(
                    () -> Component.literal("1. Copy the code  ")
                            .withStyle(LABEL)
                            .append(copyAccessButton(config, credential.token())),
                    false);
            source.sendSuccess(
                    () -> Component.literal("2. In VS Code, run  ")
                            .withStyle(LABEL)
                            .append(Component.literal("KubeVS: Connect with /kvs join code")
                                    .withStyle(BRAND)),
                    false);
            source.sendSuccess(
                    () -> Component.literal(
                                    "This private code is shown once. Running /kvs join again disconnects the previous session.")
                            .withStyle(MUTED),
                    false);
            return 1;
        } catch (IOException exception) {
            source.sendFailure(Component.literal(
                    "Could not create a KubeVS code: " + exception.getMessage()
                            + ". Run /kvs join again or contact an administrator."));
            return 0;
        }
    }

    private static int showUsers(
            CommandSourceStack source, ConnectorConfig config, KubeVSSocketServer server) {
        if (!isRunning(config, server, source)) return 0;
        var accounts = config.playerTokens().list();
        if (accounts.isEmpty()) {
            source.sendSuccess(
                    () -> Component.literal("No player accounts yet. A player can create one with ")
                            .withStyle(LABEL)
                            .append(commandHint("/kvs join", "Create a personal connection code")),
                    false);
            return 1;
        }
        source.sendSuccess(
                () -> Component.literal("KubeVS")
                        .withStyle(BRAND, ChatFormatting.BOLD)
                        .append(Component.literal("  ACCESS  ").withStyle(VALUE, ChatFormatting.BOLD))
                        .append(Component.literal(Integer.toString(accounts.size())).withStyle(SUCCESS)),
                false);
        for (PlayerTokenStore.Account account : accounts) {
            source.sendSuccess(
                    () -> Component.literal(account.playerName())
                            .withStyle(VALUE)
                            .append(Component.literal("    "))
                            .append(Component.literal(account.role().displayName())
                                    .withStyle(roleColor(account.role()), ChatFormatting.BOLD))
                            .append(Component.literal("    "))
                            .append(actionButton(
                                    "[Change role]",
                                    BRAND,
                                    ClickEvent.Action.SUGGEST_COMMAND,
                                    "/kvs role " + account.playerName() + " ",
                                    "Choose viewer, editor, operator, or admin"))
                            .append(Component.literal("  "))
                            .append(actionButton(
                                    "[Revoke]",
                                    DANGER,
                                    ClickEvent.Action.SUGGEST_COMMAND,
                                    "/kvs revoke " + account.playerName(),
                                    "Disconnect the session and delete its token")),
                    false);
        }
        return 1;
    }

    private static int setRole(
            CommandSourceStack source,
            ConnectorConfig config,
            KubeVSSocketServer server,
            String playerName,
            String roleName) {
        if (!isRunning(config, server, source)) return 0;
        try {
            ConnectorRole role = ConnectorRole.parse(roleName);
            PlayerTokenStore.Account account =
                    config.playerTokens().setRole(playerName, role).orElse(null);
            if (account == null) {
                source.sendFailure(Component.literal(
                        "Account " + playerName + " was not found. Check /kvs users; the player can create access with /kvs join."));
                return 0;
            }
            server.disconnectPlayer(account.playerId(), "KubeVS role changed");
            source.sendSuccess(
                    () -> Component.literal("Role updated: " + account.playerName() + "  ")
                            .withStyle(SUCCESS, ChatFormatting.BOLD)
                            .append(Component.literal(role.displayName()).withStyle(roleColor(role))),
                    true);
            return 1;
        } catch (IllegalArgumentException | IOException exception) {
            source.sendFailure(Component.literal("Could not change the role: " + exception.getMessage() + ". Check the player name and role with /kvs users."));
            return 0;
        }
    }

    private static int revoke(
            CommandSourceStack source,
            ConnectorConfig config,
            KubeVSSocketServer server,
            String playerName) {
        if (!isRunning(config, server, source)) return 0;
        PlayerTokenStore.Account account = config.playerTokens().list().stream()
                .filter(candidate -> candidate.playerName().equalsIgnoreCase(playerName))
                .findFirst()
                .orElse(null);
        if (account == null) {
            source.sendFailure(Component.literal("Account " + playerName + " was not found. Check the player name with /kvs users."));
            return 0;
        }
        try {
            config.playerTokens().revoke(account.playerId());
            server.disconnectPlayer(account.playerId(), "KubeVS access revoked");
            source.sendSuccess(
                    () -> Component.literal("Access revoked: " + account.playerName())
                            .withStyle(SUCCESS, ChatFormatting.BOLD),
                    true);
            return 1;
        } catch (IOException exception) {
            source.sendFailure(Component.literal("Could not revoke access: " + exception.getMessage() + ". Run the command again or check the account file."));
            return 0;
        }
    }

    private static int showAdminAccess(
            CommandSourceStack source, ConnectorConfig config, KubeVSSocketServer server) {
        if (!isRunning(config, server, source)) return 0;
        if (!(source.getEntity() instanceof ServerPlayer)) {
            source.sendFailure(Component.literal(
                    "Secrets are not printed to the console. Copy the admin token from " + config.tokenFile()));
            return 0;
        }
        source.sendSuccess(
                () -> Component.literal("Admin access  ")
                        .withStyle(LABEL)
                        .append(copyAccessButton(config, server.authenticationToken())),
                false);
        return 1;
    }

    private static int requestRotation(CommandSourceStack source, String root) {
        source.sendSuccess(
                () -> Component.literal("Rotating the token disconnects every admin session. ")
                        .withStyle(WARNING)
                        .append(Component.literal("[Confirm rotation]").withStyle(style -> style
                                .withColor(DANGER)
                                .withBold(true)
                                .withClickEvent(new ClickEvent(
                                        ClickEvent.Action.RUN_COMMAND,
                                        "/" + root + " auth rotate confirm"))
                                .withHoverEvent(new HoverEvent(
                                        HoverEvent.Action.SHOW_TEXT,
                                        Component.literal("Disconnect current admin sessions and create a new token"))))),
                false);
        return 1;
    }

    private static int rotateToken(
            CommandSourceStack source, ConnectorConfig config, KubeVSSocketServer server) {
        if (!isRunning(config, server, source)) return 0;
        try {
            String token = TokenStore.rotate(config.tokenFile());
            server.replaceAuthenticationToken(token);
            source.sendSuccess(
                    () -> Component.literal("Admin token rotated  ")
                            .withStyle(SUCCESS, ChatFormatting.BOLD)
                            .append(source.getEntity() instanceof ServerPlayer
                                    ? copyAccessButton(config, token)
                                    : Component.literal("File: " + config.tokenFile())
                                            .withStyle(VALUE)),
                    false);
            return 1;
        } catch (IOException exception) {
            source.sendFailure(Component.literal(
                    "Could not rotate the admin token: " + exception.getMessage() + ". Check write access to " + config.tokenFile()));
            return 0;
        }
    }

    private static MutableComponent copyAccessButton(ConnectorConfig config, String token) {
        String host = config.publicHost().contains(":")
                ? "[" + config.publicHost() + "]"
                : config.publicHost();
        String code = "kubevs://" + host + ":" + config.publicPort()
                + "?token=" + token
                + (config.advertisedSecure() ? "&secure=true" : "");
        return Component.literal("[Copy code]").withStyle(style -> style
                .withColor(BRAND)
                .withBold(true)
                .withUnderlined(true)
                .withClickEvent(new ClickEvent(ClickEvent.Action.COPY_TO_CLIPBOARD, code))
                .withHoverEvent(new HoverEvent(
                        HoverEvent.Action.SHOW_TEXT,
                        Component.literal("Copy the private code for VS Code: KubeVS: Connect with /kvs join code"))));
    }

    private static MutableComponent rotateButton() {
        return Component.literal("[Rotate token]").withStyle(style -> style
                .withColor(WARNING)
                .withClickEvent(new ClickEvent(ClickEvent.Action.RUN_COMMAND, "/kvs auth rotate"))
                .withHoverEvent(new HoverEvent(
                        HoverEvent.Action.SHOW_TEXT,
                        Component.literal("Create a new token after confirmation"))));
    }

    private static MutableComponent commandHint(String command, String hoverText) {
        return actionButton(
                        command,
                        BRAND,
                        ClickEvent.Action.SUGGEST_COMMAND,
                        command,
                        hoverText)
                .withStyle(ChatFormatting.BOLD);
    }

    private static MutableComponent actionButton(
            String label,
            ChatFormatting color,
            ClickEvent.Action clickAction,
            String clickValue,
            String hoverText) {
        return Component.literal(label).withStyle(style -> style
                .withColor(color)
                .withClickEvent(new ClickEvent(clickAction, clickValue))
                .withHoverEvent(new HoverEvent(
                        HoverEvent.Action.SHOW_TEXT,
                        Component.literal(hoverText).withStyle(VALUE))));
    }
    private static ChatFormatting roleColor(ConnectorRole role) {
        return switch (role) {
            case VIEWER -> ChatFormatting.DARK_GRAY;
            case EDITOR -> BRAND;
            case OPERATOR -> WARNING;
            case ADMIN -> ChatFormatting.LIGHT_PURPLE;
        };
    }

    private static boolean isRunning(
            ConnectorConfig config, KubeVSSocketServer server, CommandSourceStack source) {
        if (Objects.nonNull(config) && Objects.nonNull(server)) return true;
        source.sendFailure(Component.literal("KubeVS Connector is unavailable. Check the server and config/kubevs-connector.toml."));
        return false;
    }
}
