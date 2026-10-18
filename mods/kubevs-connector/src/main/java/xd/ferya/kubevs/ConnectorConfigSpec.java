package xd.ferya.kubevs;

import net.neoforged.neoforge.common.ModConfigSpec;

final class ConnectorConfigSpec {
    static final String FILE_NAME = "kubevs-connector.toml";
    static final String DEFAULT_HOST = "127.0.0.1";
    static final int DEFAULT_PORT = 32145;
    static final String DEFAULT_PUBLIC_HOST = "";
    static final int DEFAULT_PUBLIC_PORT = 0;
    static final boolean DEFAULT_ALLOW_REMOTE = false;
    static final boolean DEFAULT_ALLOW_RELOAD = false;
    static final int DEFAULT_JOIN_PERMISSION_LEVEL = 2;
    static final ConnectorRole DEFAULT_ROLE = ConnectorRole.EDITOR;
    static final ModConfigSpec SPEC;

    static final ModConfigSpec.ConfigValue<String> HOST;
    static final ModConfigSpec.IntValue PORT;
    static final ModConfigSpec.ConfigValue<String> PUBLIC_HOST;
    static final ModConfigSpec.IntValue PUBLIC_PORT;
    static final ModConfigSpec.BooleanValue PUBLIC_SECURE;
    static final ModConfigSpec.BooleanValue ALLOW_REMOTE;
    static final ModConfigSpec.BooleanValue ALLOW_RELOAD;
    static final ModConfigSpec.IntValue JOIN_PERMISSION_LEVEL;
    static final ModConfigSpec.EnumValue<ConnectorRole> DEFAULT_JOIN_ROLE;

    static {
        ModConfigSpec.Builder builder = new ModConfigSpec.Builder();

        builder.comment("Подключение KubeVS к Visual Studio Code.").push("network");
        HOST =
                builder.comment(
                                "Адрес, на котором Connector принимает подключения.",
                                "Для игры на этом компьютере оставьте 127.0.0.1.",
                                "На выделенном сервере укажите его адрес или 0.0.0.0 и включите allowRemote.",
                                "Адрес для кода подключения игроков задаётся отдельно в publicHost.")
                        .define("host", DEFAULT_HOST, ConnectorConfigSpec::isValidHost);
        PORT =
                builder.comment("Отдельный TCP-порт для расширения KubeVS. Не используйте порт Minecraft.")
                        .defineInRange("port", DEFAULT_PORT, 1024, 65535);
        PUBLIC_HOST =
                builder.comment(
                                "Адрес сервера, который /kvs join добавляет в код подключения.",
                                "Обязателен при host = 0.0.0.0 и при использовании TLS-прокси.",
                                "Укажите доступный игрокам домен или IP без ws://, wss:// и порта.")
                        .define("publicHost", DEFAULT_PUBLIC_HOST, ConnectorConfigSpec::isValidPublicHost);
        PUBLIC_PORT =
                builder.comment("Порт в кодах подключения. 0 — использовать network.port.")
                        .defineInRange("publicPort", DEFAULT_PUBLIC_PORT, 0, 65535);
        PUBLIC_SECURE =
                builder.comment(
                                "Создавать коды подключения с wss://.",
                                "Включайте, только если перед Connector настроен TLS-прокси.",
                                "Настройка меняет код подключения, но сама не включает TLS.")
                        .define("publicSecure", false);
        ALLOW_REMOTE =
                builder.comment(
                                "Разрешить подключения с других компьютеров.",
                                "Без TLS-прокси удалённые подключения используют ws://.",
                                "Открывайте этот порт только в доверенных сетях.")
                        .define("allowRemote", DEFAULT_ALLOW_REMOTE);
        builder.pop();

        builder.comment("Права игроков и действия с сервером.").push("permissions");
        ALLOW_RELOAD =
                builder.comment("Разрешить операторам и администраторам перезагружать рецепты из KubeVS и MCP.")
                        .define("allowReload", DEFAULT_ALLOW_RELOAD);
        JOIN_PERMISSION_LEVEL =
                builder.comment(
                                "Минимальный уровень прав Minecraft для /kvs join.",
                                "0 — все игроки, 2 — операторы, 4 — администраторы.",
                                "Владелец одиночного мира может подключиться без включения читов.")
                        .defineInRange(
                                "joinPermissionLevel", DEFAULT_JOIN_PERMISSION_LEVEL, 0, 4);
        DEFAULT_JOIN_ROLE =
                builder.comment(
                                "Роль игрока при первом подключении через /kvs join.",
                                "Администратор меняет роль командой /kvs role <игрок> <роль>.",
                                "viewer — просмотр, editor — правка файлов, operator — перезагрузка, admin — управление доступом. Старые учётные записи сохраняют свои роли.")
                        .defineEnum("defaultRole", DEFAULT_ROLE);
        builder.pop();

        SPEC = builder.build();
    }

    private ConnectorConfigSpec() {}

    private static boolean isValidPublicHost(Object value) {
        if (!(value instanceof String host)) return false;
        return host.length() <= 255 && !host.chars().anyMatch(Character::isWhitespace);
    }

    private static boolean isValidHost(Object value) {
        if (!(value instanceof String host)) {
            return false;
        }
        String trimmed = host.trim();
        return !trimmed.isEmpty() && trimmed.length() <= 255 && !trimmed.chars().anyMatch(Character::isWhitespace);
    }
}
