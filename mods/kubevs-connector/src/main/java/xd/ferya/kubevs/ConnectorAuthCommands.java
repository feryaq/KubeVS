package xd.ferya.kubevs;

import static net.minecraft.commands.Commands.literal;

import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.builder.LiteralArgumentBuilder;
import java.io.IOException;
import java.util.Objects;
import java.util.function.Supplier;
import net.minecraft.ChatFormatting;
import net.minecraft.commands.CommandSourceStack;
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
                .then(literal("auth")
                        .requires(source -> source.hasPermission(ADMIN_PERMISSION_LEVEL))
                        .executes(context -> showStatus(
                                context.getSource(), configSupplier.get(), serverSupplier.get()))
                        .then(literal("copy").executes(context -> showToken(
                                context.getSource(), configSupplier.get(), serverSupplier.get())))
                        .then(literal("rotate")
                                .executes(context -> requestRotation(context.getSource(), root))
                                .then(literal("confirm").executes(context -> rotateToken(
                                        context.getSource(),
                                        configSupplier.get(),
                                        serverSupplier.get())))))
                .then(literal("join").executes(context -> join(
                        context.getSource(), configSupplier.get(), serverSupplier.get())));
    }

    private static int showStatus(
            CommandSourceStack source, ConnectorConfig config, KubeVSSocketServer server) {
        if (!isRunning(config, server, source)) {
            return 0;
        }
        if (!source.hasPermission(ADMIN_PERMISSION_LEVEL)) {
            source.sendFailure(Component.literal(
                    "Используйте /kvs join, чтобы получить личный токен."));
            return 0;
        }

        source.sendSuccess(
                () -> Component.literal("KubeVS Connector")
                        .withStyle(ChatFormatting.GOLD, ChatFormatting.BOLD)
                        .append(Component.literal(" готов").withStyle(ChatFormatting.GREEN)),
                false);
        source.sendSuccess(
                () -> Component.literal("Адрес: ")
                        .withStyle(ChatFormatting.GRAY)
                        .append(Component.literal(config.publicHost() + ":" + config.address().getPort())
                                .withStyle(ChatFormatting.WHITE))
                        .append(Component.literal("  •  клиентов: ").withStyle(ChatFormatting.DARK_GRAY))
                        .append(Component.literal(Integer.toString(server.connectedClientCount()))
                                .withStyle(ChatFormatting.WHITE)),
                false);

        if (source.getEntity() instanceof ServerPlayer) {
            source.sendSuccess(
                    () -> Component.literal("Авторизация: ")
                            .withStyle(ChatFormatting.GRAY)
                            .append(copyButton(server.authenticationToken()))
                            .append(Component.literal("  "))
                            .append(copyAddressButton(config))
                            .append(Component.literal("  "))
                            .append(rotateButton()),
                    false);
        } else {
            source.sendSuccess(
                    () -> Component.literal("Файл админ-токена: ")
                            .withStyle(ChatFormatting.GRAY)
                            .append(Component.literal(config.tokenFile().toAbsolutePath().normalize().toString())
                                    .withStyle(ChatFormatting.WHITE)),
                    false);
        }
        return 1;
    }

    private static int showToken(
            CommandSourceStack source, ConnectorConfig config, KubeVSSocketServer server) {
        if (!isRunning(config, server, source)) {
            return 0;
        }
        if (!(source.getEntity() instanceof ServerPlayer)) {
            source.sendFailure(Component.literal(
                    "Токен не выводится в консоль. Прочитайте его из "
                            + config.tokenFile().toAbsolutePath().normalize()));
            return 0;
        }

        source.sendSuccess(
                () -> Component.literal("Нажмите для копирования: ")
                        .withStyle(ChatFormatting.GRAY)
                        .append(copyButton(server.authenticationToken()))
                        .append(Component.literal("  "))
                        .append(copyAddressButton(config)),
                false);
        return 1;
    }

    private static int join(
            CommandSourceStack source, ConnectorConfig config, KubeVSSocketServer server) {
        if (!isRunning(config, server, source)) {
            return 0;
        }
        if (!(source.getEntity() instanceof ServerPlayer player)) {
            source.sendFailure(Component.literal(
                    "Команда /kvs join доступна только игроку. Консоль использует админ-токен."));
            return 0;
        }
        if (!source.hasPermission(config.joinPermissionLevel())) {
            source.sendFailure(Component.literal(
                    "Недостаточно прав для /kvs join. Требуется уровень "
                            + config.joinPermissionLevel()
                            + "."));
            return 0;
        }

        try {
            PlayerTokenStore.Credential credential =
                    config.playerTokens().issue(
                            player.getUUID(),
                            player.getGameProfile().getName(),
                            highestPermissionLevel(source));
            source.sendSuccess(
                    () -> Component.literal("KubeVS: личный доступ для ")
                            .withStyle(ChatFormatting.GOLD, ChatFormatting.BOLD)
                            .append(Component.literal(credential.playerName())
                                    .withStyle(ChatFormatting.WHITE)),
                    false);
            source.sendSuccess(
                    () -> Component.literal(config.publicHost() + ":" + config.address().getPort() + "  ")
                            .withStyle(ChatFormatting.GRAY)
                            .append(copyButton(credential.token()))
                            .append(Component.literal("  "))
                            .append(copyAddressButton(config)),
                    false);
            source.sendSuccess(
                    () -> Component.literal(
                                    "Токен привязан к вашему UUID. Не отправляйте его в чат и не публикуйте.")
                            .withStyle(ChatFormatting.DARK_GRAY),
                    false);
            return 1;
        } catch (IOException exception) {
            source.sendFailure(Component.literal(
                    "Не удалось сохранить личный токен KubeVS: " + exception.getMessage()));
            return 0;
        }
    }

    private static int requestRotation(CommandSourceStack source, String root) {
        MutableComponent confirm = Component.literal("[Подтвердить замену]").withStyle(style -> style
                .withColor(ChatFormatting.RED)
                .withBold(true)
                .withClickEvent(new ClickEvent(
                        ClickEvent.Action.RUN_COMMAND, "/" + root + " auth rotate confirm"))
                .withHoverEvent(new HoverEvent(
                        HoverEvent.Action.SHOW_TEXT,
                        Component.literal("Создать новый админ-токен и отключить клиентов"))));
        source.sendSuccess(
                () -> Component.literal("Текущие подключения VS Code будут закрыты. ")
                        .withStyle(ChatFormatting.YELLOW)
                        .append(confirm),
                false);
        return 1;
    }

    private static int rotateToken(
            CommandSourceStack source, ConnectorConfig config, KubeVSSocketServer server) {
        if (!isRunning(config, server, source)) {
            return 0;
        }

        try {
            String token = TokenStore.rotate(config.tokenFile());
            server.replaceAuthenticationToken(token);
            source.sendSuccess(
                    () -> Component.literal("Админ-токен заменён. ")
                            .withStyle(ChatFormatting.GREEN)
                            .append(source.getEntity() instanceof ServerPlayer
                                    ? copyButton(token)
                                    : Component.literal("Новый токен находится в " + config.tokenFile())
                                            .withStyle(ChatFormatting.WHITE)),
                    false);
            return 1;
        } catch (IOException exception) {
            source.sendFailure(Component.literal(
                    "Не удалось заменить админ-токен: " + exception.getMessage()));
            return 0;
        }
    }

    private static MutableComponent copyButton(String token) {
        return Component.literal("[Копировать токен]").withStyle(style -> style
                .withColor(ChatFormatting.AQUA)
                .withBold(true)
                .withUnderlined(true)
                .withClickEvent(new ClickEvent(ClickEvent.Action.COPY_TO_CLIPBOARD, token))
                .withHoverEvent(new HoverEvent(
                        HoverEvent.Action.SHOW_TEXT,
                        Component.literal("Скопировать токен Connector в буфер обмена"))));
    }

    private static MutableComponent copyAddressButton(ConnectorConfig config) {
        String address = config.publicHost() + ":" + config.address().getPort();
        return Component.literal("[Копировать адрес]").withStyle(style -> style
                .withColor(ChatFormatting.GREEN)
                .withUnderlined(true)
                .withClickEvent(new ClickEvent(ClickEvent.Action.COPY_TO_CLIPBOARD, address))
                .withHoverEvent(new HoverEvent(
                        HoverEvent.Action.SHOW_TEXT,
                        Component.literal("Скопировать адрес и текущий порт Connector"))));
    }

    private static MutableComponent rotateButton() {
        return Component.literal("[Заменить]").withStyle(style -> style
                .withColor(ChatFormatting.YELLOW)
                .withClickEvent(new ClickEvent(
                        ClickEvent.Action.RUN_COMMAND, "/kvs auth rotate"))
                .withHoverEvent(new HoverEvent(
                        HoverEvent.Action.SHOW_TEXT,
                        Component.literal("Заменить скомпрометированный админ-токен"))));
    }

    private static boolean isRunning(
            ConnectorConfig config, KubeVSSocketServer server, CommandSourceStack source) {
        if (Objects.nonNull(config) && Objects.nonNull(server)) {
            return true;
        }
        source.sendFailure(Component.literal("KubeVS Connector не запущен."));
        return false;
    }

    private static int highestPermissionLevel(CommandSourceStack source) {
        for (int level = 4; level >= 0; level--) {
            if (source.hasPermission(level)) {
                return level;
            }
        }
        return 0;
    }
}
