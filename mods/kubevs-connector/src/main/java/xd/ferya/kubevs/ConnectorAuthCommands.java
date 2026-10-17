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
    private static final int ADMIN_PERMISSION_LEVEL = 4;
    private static final String LATEST_RELEASE_URL =
            "https://github.com/Feryaq/KubeVS/releases/latest";
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
                .executes(context -> showStatus(
                        context.getSource(), configSupplier.get(), serverSupplier.get()))
                .then(literal("status").executes(context -> showStatus(
                        context.getSource(), configSupplier.get(), serverSupplier.get())))
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
                () -> Component.literal("KubeVS  ").withStyle(BRAND, ChatFormatting.BOLD)
                        .append(tr("status.online").withStyle(SUCCESS))
                        .append(tr("status.clients", server.connectedClientCount()).withStyle(LABEL)),
                false);
        source.sendSuccess(
                () -> Component.literal(config.publicHost() + ":" + config.publicPort()).withStyle(VALUE)
                        .append(tr(config.allowReload() ? "status.reload_enabled" : "status.reload_disabled")
                                .withStyle(MUTED)),
                false);
        MutableComponent actions = actionButton("action.connect", BRAND, ClickEvent.Action.RUN_COMMAND,
                "/kvs join", "hover.connect")
                .append(Component.literal("  "))
                .append(actionButton("action.extension", BRAND, ClickEvent.Action.OPEN_URL,
                        LATEST_RELEASE_URL, "hover.extension"));
        if (source.hasPermission(ADMIN_PERMISSION_LEVEL)) {
            actions.append(Component.literal("  "))
                    .append(actionButton("action.manage", BRAND, ClickEvent.Action.RUN_COMMAND,
                            "/kvs users", "hover.manage"));
        }
        source.sendSuccess(() -> actions, false);
        return 1;
    }

    private static int join(
            CommandSourceStack source, ConnectorConfig config, KubeVSSocketServer server) {
        if (!isRunning(config, server, source)) return 0;
        if (!(source.getEntity() instanceof ServerPlayer player)) {
            source.sendFailure(tr("join.player_only", config.tokenFile()));
            return 0;
        }
        boolean ownsSingleplayerWorld = source.getServer().isSingleplayer()
                && source.getServer().isSingleplayerOwner(player.getGameProfile());
        if (!source.hasPermission(config.joinPermissionLevel()) && !ownsSingleplayerWorld) {
            source.sendFailure(tr("join.permission", config.joinPermissionLevel()));
            return 0;
        }

        try {
            PlayerTokenStore.Credential credential = config.playerTokens().issue(
                    player.getUUID(),
                    player.getGameProfile().getName(),
                    config.defaultJoinRole());
            server.disconnectPlayer(player.getUUID(), "A new KubeVS token was issued");
            source.sendSuccess(
                    () -> tr("join.ready", Component.literal(credential.playerName()).withStyle(VALUE))
                            .withStyle(SUCCESS, ChatFormatting.BOLD)
                            .append(roleName(credential.role())
                                    .withStyle(roleColor(credential.role()), ChatFormatting.BOLD)),
                    false);
            source.sendSuccess(
                    () -> tr("join.step_copy").withStyle(LABEL)
                            .append(copyAccessButton(config, credential.token())),
                    false);
            source.sendSuccess(
                    () -> tr("join.step_extension").withStyle(LABEL),
                    false);
            source.sendSuccess(
                    () -> tr("join.once")
                            .withStyle(MUTED),
                    false);
            return 1;
        } catch (IOException exception) {
            source.sendFailure(tr("join.failed", exception.getMessage()));
            return 0;
        }
    }

    private static int showUsers(
            CommandSourceStack source, ConnectorConfig config, KubeVSSocketServer server) {
        if (!isRunning(config, server, source)) return 0;
        var accounts = config.playerTokens().list();
        if (accounts.isEmpty()) {
            source.sendSuccess(
                    () -> tr("users.empty")
                            .withStyle(LABEL)
                            .append(commandHint("/kvs join", "hover.connect")),
                    false);
            return 1;
        }
        source.sendSuccess(
                () -> Component.literal("KubeVS")
                        .withStyle(BRAND, ChatFormatting.BOLD)
                        .append(tr("users.count", accounts.size()).withStyle(VALUE)),
                false);
        for (PlayerTokenStore.Account account : accounts) {
            source.sendSuccess(
                    () -> Component.literal(account.playerName())
                            .withStyle(VALUE)
                            .append(Component.literal("    "))
                            .append(roleName(account.role())
                                    .withStyle(roleColor(account.role()), ChatFormatting.BOLD))
                            .append(Component.literal("    "))
                            .append(actionButton(
                                    "action.role",
                                    BRAND,
                                    ClickEvent.Action.SUGGEST_COMMAND,
                                    "/kvs role " + account.playerName() + " ",
                                    "hover.role"))
                            .append(Component.literal("  "))
                            .append(actionButton(
                                    "action.revoke",
                                    DANGER,
                                    ClickEvent.Action.SUGGEST_COMMAND,
                                    "/kvs revoke " + account.playerName(),
                                    "hover.revoke")),
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
                source.sendFailure(tr("users.not_found", playerName));
                return 0;
            }
            server.disconnectPlayer(account.playerId(), "KubeVS role changed");
            source.sendSuccess(
                    () -> tr("role.updated", account.playerName())
                            .withStyle(SUCCESS, ChatFormatting.BOLD)
                            .append(roleName(role).withStyle(roleColor(role))),
                    true);
            return 1;
        } catch (IllegalArgumentException | IOException exception) {
            source.sendFailure(tr("role.failed", exception.getMessage()));
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
            source.sendFailure(tr("users.not_found", playerName));
            return 0;
        }
        try {
            config.playerTokens().revoke(account.playerId());
            server.disconnectPlayer(account.playerId(), "KubeVS access revoked");
            source.sendSuccess(
                    () -> tr("revoke.done", account.playerName())
                            .withStyle(SUCCESS, ChatFormatting.BOLD),
                    true);
            return 1;
        } catch (IOException exception) {
            source.sendFailure(tr("revoke.failed", exception.getMessage()));
            return 0;
        }
    }

    private static int showAdminAccess(
            CommandSourceStack source, ConnectorConfig config, KubeVSSocketServer server) {
        if (!isRunning(config, server, source)) return 0;
        if (!(source.getEntity() instanceof ServerPlayer)) {
            source.sendFailure(tr("auth.console", config.tokenFile()));
            return 0;
        }
        source.sendSuccess(
                () -> tr("auth.admin")
                        .withStyle(LABEL)
                        .append(copyAccessButton(config, server.authenticationToken())),
                false);
        return 1;
    }

    private static int requestRotation(CommandSourceStack source, String root) {
        source.sendSuccess(
                () -> tr("auth.rotate_warning")
                        .withStyle(WARNING)
                        .append(tr("action.confirm_rotation").withStyle(style -> style
                                .withColor(DANGER)
                                .withBold(true)
                                .withClickEvent(new ClickEvent(
                                        ClickEvent.Action.RUN_COMMAND,
                                        "/" + root + " auth rotate confirm"))
                                .withHoverEvent(new HoverEvent(
                                        HoverEvent.Action.SHOW_TEXT,
                                        tr("hover.confirm_rotation"))))),
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
                    () -> tr("auth.rotated")
                            .withStyle(SUCCESS, ChatFormatting.BOLD)
                            .append(source.getEntity() instanceof ServerPlayer
                                    ? copyAccessButton(config, token)
                                    : tr("auth.file", config.tokenFile())
                                            .withStyle(VALUE)),
                    false);
            return 1;
        } catch (IOException exception) {
            source.sendFailure(tr("auth.rotate_failed", exception.getMessage(), config.tokenFile()));
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
        return tr("action.copy").withStyle(style -> style
                .withColor(BRAND)
                .withBold(true)
                .withUnderlined(true)
                .withClickEvent(new ClickEvent(ClickEvent.Action.COPY_TO_CLIPBOARD, code))
                .withHoverEvent(new HoverEvent(
                        HoverEvent.Action.SHOW_TEXT,
                        tr("hover.copy"))));
    }

    private static MutableComponent commandHint(String command, String hoverKey) {
        return Component.literal(command).withStyle(style -> style
                .withColor(BRAND)
                .withBold(true)
                .withClickEvent(new ClickEvent(ClickEvent.Action.SUGGEST_COMMAND, command))
                .withHoverEvent(new HoverEvent(HoverEvent.Action.SHOW_TEXT, tr(hoverKey))));
    }

    private static MutableComponent actionButton(
            String labelKey,
            ChatFormatting color,
            ClickEvent.Action clickAction,
            String clickValue,
            String hoverKey) {
        return tr(labelKey).withStyle(style -> style
                .withColor(color)
                .withClickEvent(new ClickEvent(clickAction, clickValue))
                .withHoverEvent(new HoverEvent(
                        HoverEvent.Action.SHOW_TEXT,
                        tr(hoverKey).withStyle(VALUE))));
    }
    private static MutableComponent tr(String key, Object... args) {
        String fullKey = "command.kubevs." + key;
        return Component.translatableWithFallback(
                fullKey, ConnectorTranslations.englishFallback(fullKey), args);
    }

    private static MutableComponent roleName(ConnectorRole role) {
        return tr("role." + role.id());
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
        source.sendFailure(tr("unavailable"));
        return false;
    }
}
