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
                () -> Component.literal("Адрес  ")
                        .withStyle(LABEL)
                        .append(Component.literal(config.publicHost() + ":" + config.publicPort())
                                .withStyle(VALUE))
                        .append(Component.literal("    Клиенты VS Code  ").withStyle(MUTED))
                        .append(Component.literal(Integer.toString(server.connectedClientCount()))
                                .withStyle(server.connectedClientCount() > 0 ? SUCCESS : VALUE)),
                false);

        if (!source.hasPermission(ADMIN_PERMISSION_LEVEL)) {
            source.sendSuccess(
                    () -> Component.literal("Подключить VS Code  ")
                            .withStyle(LABEL)
                            .append(commandHint("/kvs join", "Создать личный код подключения")),
                    false);
            return 1;
        }

        source.sendSuccess(
                () -> Component.literal("Аккаунты  ")
                        .withStyle(LABEL)
                        .append(Component.literal(Integer.toString(config.playerTokens().size()))
                                .withStyle(VALUE))
                        .append(Component.literal("    "))
                        .append(actionButton(
                                "[Управление]",
                                BRAND,
                                ClickEvent.Action.RUN_COMMAND,
                                "/kvs users",
                                "Открыть список ролей и доступов")),
                false);
        if (source.getEntity() instanceof ServerPlayer) {
            source.sendSuccess(
                    () -> Component.literal("Администратор  ")
                            .withStyle(LABEL)
                            .append(copyAccessButton(config, server.authenticationToken()))
                            .append(Component.literal("    "))
                            .append(rotateButton()),
                    false);
        } else {
            source.sendSuccess(
                    () -> Component.literal("Админ-токен  ")
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
                    "/kvs join работает только для игрока. В консоли используйте админ-токен из "
                            + config.tokenFile()));
            return 0;
        }
        if (!source.hasPermission(config.joinPermissionLevel())) {
            source.sendFailure(Component.literal(
                    "Недостаточно прав: нужен уровень команд " + config.joinPermissionLevel()
                            + ". Обратитесь к администратору сервера."));
            return 0;
        }

        try {
            PlayerTokenStore.Credential credential = config.playerTokens().issue(
                    player.getUUID(),
                    player.getGameProfile().getName(),
                    config.defaultJoinRole());
            server.disconnectPlayer(player.getUUID(), "Выдан новый токен KubeVS");
            source.sendSuccess(
                    () -> Component.literal("ДОСТУП KUBEVS ГОТОВ")
                            .withStyle(SUCCESS, ChatFormatting.BOLD),
                    false);
            source.sendSuccess(
                    () -> Component.literal("Аккаунт  ")
                            .withStyle(LABEL)
                            .append(Component.literal(credential.playerName()).withStyle(VALUE))
                            .append(Component.literal("    Роль  ").withStyle(MUTED))
                            .append(Component.literal(credential.role().displayName())
                                    .withStyle(roleColor(credential.role()), ChatFormatting.BOLD)),
                    false);
            source.sendSuccess(
                    () -> Component.literal("1. Скопируйте код  ")
                            .withStyle(LABEL)
                            .append(copyAccessButton(config, credential.token())),
                    false);
            source.sendSuccess(
                    () -> Component.literal("2. В VS Code откройте  ")
                            .withStyle(LABEL)
                            .append(Component.literal("KubeVS: Connect with /kvs join code")
                                    .withStyle(BRAND)),
                    false);
            source.sendSuccess(
                    () -> Component.literal(
                                    "Код приватный и показывается один раз. Новый /kvs join отключит старую сессию.")
                            .withStyle(MUTED),
                    false);
            return 1;
        } catch (IOException exception) {
            source.sendFailure(Component.literal(
                    "Не удалось создать код KubeVS: " + exception.getMessage()
                            + ". Повторите /kvs join или сообщите администратору."));
            return 0;
        }
    }

    private static int showUsers(
            CommandSourceStack source, ConnectorConfig config, KubeVSSocketServer server) {
        if (!isRunning(config, server, source)) return 0;
        var accounts = config.playerTokens().list();
        if (accounts.isEmpty()) {
            source.sendSuccess(
                    () -> Component.literal("Аккаунтов пока нет. Игрок создаёт доступ командой ")
                            .withStyle(LABEL)
                            .append(commandHint("/kvs join", "Создать личный код подключения")),
                    false);
            return 1;
        }
        source.sendSuccess(
                () -> Component.literal("KubeVS")
                        .withStyle(BRAND, ChatFormatting.BOLD)
                        .append(Component.literal("  ДОСТУПЫ  ").withStyle(VALUE, ChatFormatting.BOLD))
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
                                    "[Изменить роль]",
                                    BRAND,
                                    ClickEvent.Action.SUGGEST_COMMAND,
                                    "/kvs role " + account.playerName() + " ",
                                    "Выбрать viewer, editor, operator или admin"))
                            .append(Component.literal("  "))
                            .append(actionButton(
                                    "[Отозвать]",
                                    DANGER,
                                    ClickEvent.Action.SUGGEST_COMMAND,
                                    "/kvs revoke " + account.playerName(),
                                    "Отключить сессию и удалить токен")),
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
                        "Аккаунт " + playerName + " не найден. Проверьте имя через /kvs users; игрок может создать доступ командой /kvs join."));
                return 0;
            }
            server.disconnectPlayer(account.playerId(), "Роль KubeVS изменена");
            source.sendSuccess(
                    () -> Component.literal("Роль обновлена: " + account.playerName() + "  ")
                            .withStyle(SUCCESS, ChatFormatting.BOLD)
                            .append(Component.literal(role.displayName()).withStyle(roleColor(role))),
                    true);
            return 1;
        } catch (IllegalArgumentException | IOException exception) {
            source.sendFailure(Component.literal("Не удалось изменить роль: " + exception.getMessage() + ". Проверьте имя и роль через /kvs users."));
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
            source.sendFailure(Component.literal("Аккаунт " + playerName + " не найден. Проверьте имя через /kvs users."));
            return 0;
        }
        try {
            config.playerTokens().revoke(account.playerId());
            server.disconnectPlayer(account.playerId(), "Доступ KubeVS отозван");
            source.sendSuccess(
                    () -> Component.literal("Доступ отозван: " + account.playerName())
                            .withStyle(SUCCESS, ChatFormatting.BOLD),
                    true);
            return 1;
        } catch (IOException exception) {
            source.sendFailure(Component.literal("Не удалось отозвать доступ: " + exception.getMessage() + ". Повторите команду или проверьте файл аккаунтов."));
            return 0;
        }
    }

    private static int showAdminAccess(
            CommandSourceStack source, ConnectorConfig config, KubeVSSocketServer server) {
        if (!isRunning(config, server, source)) return 0;
        if (!(source.getEntity() instanceof ServerPlayer)) {
            source.sendFailure(Component.literal(
                    "Секрет не выводится в консоль. Скопируйте админ-токен из файла " + config.tokenFile()));
            return 0;
        }
        source.sendSuccess(
                () -> Component.literal("Админ-доступ  ")
                        .withStyle(LABEL)
                        .append(copyAccessButton(config, server.authenticationToken())),
                false);
        return 1;
    }

    private static int requestRotation(CommandSourceStack source, String root) {
        source.sendSuccess(
                () -> Component.literal("Смена токена отключит все админ-сессии. ")
                        .withStyle(WARNING)
                        .append(Component.literal("[Подтвердить смену]").withStyle(style -> style
                                .withColor(DANGER)
                                .withBold(true)
                                .withClickEvent(new ClickEvent(
                                        ClickEvent.Action.RUN_COMMAND,
                                        "/" + root + " auth rotate confirm"))
                                .withHoverEvent(new HoverEvent(
                                        HoverEvent.Action.SHOW_TEXT,
                                        Component.literal("Отключить текущие админ-сессии и создать новый токен"))))),
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
                    () -> Component.literal("Админ-токен обновлён  ")
                            .withStyle(SUCCESS, ChatFormatting.BOLD)
                            .append(source.getEntity() instanceof ServerPlayer
                                    ? copyAccessButton(config, token)
                                    : Component.literal("Файл: " + config.tokenFile())
                                            .withStyle(VALUE)),
                    false);
            return 1;
        } catch (IOException exception) {
            source.sendFailure(Component.literal(
                    "Не удалось обновить админ-токен: " + exception.getMessage() + ". Проверьте права записи для " + config.tokenFile()));
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
        return Component.literal("[Скопировать код]").withStyle(style -> style
                .withColor(BRAND)
                .withBold(true)
                .withUnderlined(true)
                .withClickEvent(new ClickEvent(ClickEvent.Action.COPY_TO_CLIPBOARD, code))
                .withHoverEvent(new HoverEvent(
                        HoverEvent.Action.SHOW_TEXT,
                        Component.literal("Скопировать приватный код для команды VS Code: KubeVS: Connect with /kvs join code"))));
    }

    private static MutableComponent rotateButton() {
        return Component.literal("[Сменить токен]").withStyle(style -> style
                .withColor(WARNING)
                .withClickEvent(new ClickEvent(ClickEvent.Action.RUN_COMMAND, "/kvs auth rotate"))
                .withHoverEvent(new HoverEvent(
                        HoverEvent.Action.SHOW_TEXT,
                        Component.literal("Создать новый токен после отдельного подтверждения"))));
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
        source.sendFailure(Component.literal("KubeVS Connector недоступен. Проверьте запуск сервера и config/kubevs-connector.toml."));
        return false;
    }
}
