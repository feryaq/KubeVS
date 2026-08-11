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
                () -> Component.literal("KubeVS Connector")
                        .withStyle(ChatFormatting.GOLD, ChatFormatting.BOLD)
                        .append(Component.literal("  ● работает").withStyle(ChatFormatting.GREEN)),
                false);
        source.sendSuccess(
                () -> Component.literal("Сервер: ")
                        .withStyle(ChatFormatting.GRAY)
                        .append(Component.literal(config.publicHost() + ":" + config.publicPort())
                                .withStyle(ChatFormatting.WHITE))
                        .append(Component.literal("  •  VS Code: ").withStyle(ChatFormatting.DARK_GRAY))
                        .append(Component.literal(Integer.toString(server.connectedClientCount()))
                                .withStyle(ChatFormatting.WHITE)),
                false);

        if (!source.hasPermission(ADMIN_PERMISSION_LEVEL)) {
            source.sendSuccess(
                    () -> Component.literal("Для личного подключения используйте ")
                            .withStyle(ChatFormatting.GRAY)
                            .append(Component.literal("/kvs join")
                                    .withStyle(ChatFormatting.AQUA, ChatFormatting.BOLD)),
                    false);
            return 1;
        }

        source.sendSuccess(
                () -> Component.literal("Аккаунты: ")
                        .withStyle(ChatFormatting.GRAY)
                        .append(Component.literal(Integer.toString(config.playerTokens().size()))
                                .withStyle(ChatFormatting.WHITE))
                        .append(Component.literal("  "))
                        .append(Component.literal("[Список]").withStyle(style -> style
                                .withColor(ChatFormatting.AQUA)
                                .withClickEvent(new ClickEvent(
                                        ClickEvent.Action.RUN_COMMAND, "/kvs users"))
                                .withHoverEvent(new HoverEvent(
                                        HoverEvent.Action.SHOW_TEXT,
                                        Component.literal("Показать роли и аккаунты KubeVS"))))),
                false);
        if (source.getEntity() instanceof ServerPlayer) {
            source.sendSuccess(
                    () -> Component.literal("Администратор: ")
                            .withStyle(ChatFormatting.GRAY)
                            .append(copyAccessButton(config, server.authenticationToken()))
                            .append(Component.literal("  "))
                            .append(rotateButton()),
                    false);
        } else {
            source.sendSuccess(
                    () -> Component.literal("Админ-токен: ")
                            .withStyle(ChatFormatting.GRAY)
                            .append(Component.literal(config.tokenFile().toAbsolutePath().normalize().toString())
                                    .withStyle(ChatFormatting.WHITE)),
                    false);
        }
        return 1;
    }

    private static int join(
            CommandSourceStack source, ConnectorConfig config, KubeVSSocketServer server) {
        if (!isRunning(config, server, source)) return 0;
        if (!(source.getEntity() instanceof ServerPlayer player)) {
            source.sendFailure(Component.literal(
                    "Команда /kvs join доступна игроку. Консоль использует админ-токен."));
            return 0;
        }
        if (!source.hasPermission(config.joinPermissionLevel())) {
            source.sendFailure(Component.literal(
                    "Для подключения нужен уровень команд " + config.joinPermissionLevel() + "."));
            return 0;
        }

        try {
            PlayerTokenStore.Credential credential = config.playerTokens().issue(
                    player.getUUID(),
                    player.getGameProfile().getName(),
                    config.defaultJoinRole());
            server.disconnectPlayer(player.getUUID(), "Выдан новый токен KubeVS");
            source.sendSuccess(
                    () -> Component.literal("KubeVS • ")
                            .withStyle(ChatFormatting.GOLD, ChatFormatting.BOLD)
                            .append(Component.literal(credential.playerName()).withStyle(ChatFormatting.WHITE))
                            .append(Component.literal("  "))
                            .append(Component.literal(credential.role().displayName())
                                    .withStyle(roleColor(credential.role()))),
                    false);
            source.sendSuccess(
                    () -> Component.literal("Откройте в VS Code: ")
                            .withStyle(ChatFormatting.GRAY)
                            .append(copyAccessButton(config, credential.token())),
                    false);
            source.sendSuccess(
                    () -> Component.literal(
                                    "Код показан один раз. Повторный /kvs join заменит старый токен.")
                            .withStyle(ChatFormatting.DARK_GRAY),
                    false);
            return 1;
        } catch (IOException exception) {
            source.sendFailure(Component.literal(
                    "Не удалось создать аккаунт KubeVS: " + exception.getMessage()));
            return 0;
        }
    }

    private static int showUsers(
            CommandSourceStack source, ConnectorConfig config, KubeVSSocketServer server) {
        if (!isRunning(config, server, source)) return 0;
        var accounts = config.playerTokens().list();
        if (accounts.isEmpty()) {
            source.sendSuccess(
                    () -> Component.literal(
                                    "Аккаунтов KubeVS нет. Игрок создаёт аккаунт через /kvs join.")
                            .withStyle(ChatFormatting.GRAY),
                    false);
            return 1;
        }
        source.sendSuccess(
                () -> Component.literal("Аккаунты KubeVS (" + accounts.size() + ")")
                        .withStyle(ChatFormatting.GOLD, ChatFormatting.BOLD),
                false);
        for (PlayerTokenStore.Account account : accounts) {
            source.sendSuccess(
                    () -> Component.literal("• " + account.playerName() + "  ")
                            .withStyle(ChatFormatting.WHITE)
                            .append(Component.literal(account.role().id())
                                    .withStyle(roleColor(account.role())))
                            .append(Component.literal("  [изменить]").withStyle(style -> style
                                    .withColor(ChatFormatting.AQUA)
                                    .withClickEvent(new ClickEvent(
                                            ClickEvent.Action.SUGGEST_COMMAND,
                                            "/kvs role " + account.playerName() + " "))
                                    .withHoverEvent(new HoverEvent(
                                            HoverEvent.Action.SHOW_TEXT,
                                            Component.literal("viewer, editor, operator или admin")))))
                            .append(Component.literal("  [отозвать]").withStyle(style -> style
                                    .withColor(ChatFormatting.RED)
                                    .withClickEvent(new ClickEvent(
                                            ClickEvent.Action.SUGGEST_COMMAND,
                                            "/kvs revoke " + account.playerName()))
                                    .withHoverEvent(new HoverEvent(
                                            HoverEvent.Action.SHOW_TEXT,
                                            Component.literal("Отозвать токен и отключить сессию"))))),
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
                        "Аккаунт " + playerName + " не найден. Игроку нужно выполнить /kvs join."));
                return 0;
            }
            server.disconnectPlayer(account.playerId(), "Роль KubeVS изменена");
            source.sendSuccess(
                    () -> Component.literal("KubeVS: " + account.playerName() + " → ")
                            .withStyle(ChatFormatting.GREEN)
                            .append(Component.literal(role.displayName()).withStyle(roleColor(role))),
                    true);
            return 1;
        } catch (IllegalArgumentException | IOException exception) {
            source.sendFailure(Component.literal("Не удалось изменить роль: " + exception.getMessage()));
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
            source.sendFailure(Component.literal("Аккаунт " + playerName + " не найден."));
            return 0;
        }
        try {
            config.playerTokens().revoke(account.playerId());
            server.disconnectPlayer(account.playerId(), "Доступ KubeVS отозван");
            source.sendSuccess(
                    () -> Component.literal("Доступ KubeVS отозван у " + account.playerName())
                            .withStyle(ChatFormatting.GREEN),
                    true);
            return 1;
        } catch (IOException exception) {
            source.sendFailure(Component.literal("Не удалось отозвать доступ: " + exception.getMessage()));
            return 0;
        }
    }

    private static int showAdminAccess(
            CommandSourceStack source, ConnectorConfig config, KubeVSSocketServer server) {
        if (!isRunning(config, server, source)) return 0;
        if (!(source.getEntity() instanceof ServerPlayer)) {
            source.sendFailure(Component.literal(
                    "Секрет не выводится в консоль. Используйте файл " + config.tokenFile()));
            return 0;
        }
        source.sendSuccess(
                () -> Component.literal("Полный доступ администратора: ")
                        .withStyle(ChatFormatting.GRAY)
                        .append(copyAccessButton(config, server.authenticationToken())),
                false);
        return 1;
    }

    private static int requestRotation(CommandSourceStack source, String root) {
        source.sendSuccess(
                () -> Component.literal("Все админ-сессии будут отключены. ")
                        .withStyle(ChatFormatting.YELLOW)
                        .append(Component.literal("[Подтвердить]").withStyle(style -> style
                                .withColor(ChatFormatting.RED)
                                .withBold(true)
                                .withClickEvent(new ClickEvent(
                                        ClickEvent.Action.RUN_COMMAND,
                                        "/" + root + " auth rotate confirm"))
                                .withHoverEvent(new HoverEvent(
                                        HoverEvent.Action.SHOW_TEXT,
                                        Component.literal("Заменить админ-токен"))))),
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
                    () -> Component.literal("Админ-токен заменён. ")
                            .withStyle(ChatFormatting.GREEN)
                            .append(source.getEntity() instanceof ServerPlayer
                                    ? copyAccessButton(config, token)
                                    : Component.literal("Файл: " + config.tokenFile())
                                            .withStyle(ChatFormatting.WHITE)),
                    false);
            return 1;
        } catch (IOException exception) {
            source.sendFailure(Component.literal(
                    "Не удалось заменить админ-токен: " + exception.getMessage()));
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
        return Component.literal("[Копировать код подключения]").withStyle(style -> style
                .withColor(ChatFormatting.AQUA)
                .withBold(true)
                .withUnderlined(true)
                .withClickEvent(new ClickEvent(ClickEvent.Action.COPY_TO_CLIPBOARD, code))
                .withHoverEvent(new HoverEvent(
                        HoverEvent.Action.SHOW_TEXT,
                        Component.literal("В VS Code: KubeVS: Подключиться по коду"))));
    }

    private static MutableComponent rotateButton() {
        return Component.literal("[Заменить админ-токен]").withStyle(style -> style
                .withColor(ChatFormatting.YELLOW)
                .withClickEvent(new ClickEvent(ClickEvent.Action.RUN_COMMAND, "/kvs auth rotate"))
                .withHoverEvent(new HoverEvent(
                        HoverEvent.Action.SHOW_TEXT,
                        Component.literal("Отключить админ-сессии и создать новый токен"))));
    }

    private static ChatFormatting roleColor(ConnectorRole role) {
        return switch (role) {
            case VIEWER -> ChatFormatting.GRAY;
            case EDITOR -> ChatFormatting.AQUA;
            case OPERATOR -> ChatFormatting.GOLD;
            case ADMIN -> ChatFormatting.LIGHT_PURPLE;
        };
    }

    private static boolean isRunning(
            ConnectorConfig config, KubeVSSocketServer server, CommandSourceStack source) {
        if (Objects.nonNull(config) && Objects.nonNull(server)) return true;
        source.sendFailure(Component.literal("KubeVS Connector не запущен."));
        return false;
    }
}
