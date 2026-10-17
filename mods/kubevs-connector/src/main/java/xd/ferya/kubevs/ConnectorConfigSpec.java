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

        builder.comment("KubeVS Connector network settings.").push("network");
        HOST =
                builder.comment(
                                "Address to listen on.",
                                "Keep 127.0.0.1 for a local game.",
                                "For a dedicated server use its bind address or 0.0.0.0 and enable allowRemote.",
                                "A bind address is not the address copied to players; set publicHost for that.")
                        .define("host", DEFAULT_HOST, ConnectorConfigSpec::isValidHost);
        PORT =
                builder.comment("WebSocket port used by KubeVS and the VS Code extension.")
                        .defineInRange("port", DEFAULT_PORT, 1024, 65535);
        PUBLIC_HOST =
                builder.comment(
                                "Public hostname copied by /kvs join.",
                                "Required when host is 0.0.0.0 or a TLS reverse proxy is used.",
                                "Use a hostname or IP that players can reach; do not include a scheme or port.")
                        .define("publicHost", DEFAULT_PUBLIC_HOST, ConnectorConfigSpec::isValidPublicHost);
        PUBLIC_PORT =
                builder.comment("Port copied into connection codes. 0 uses network.port.")
                        .defineInRange("publicPort", DEFAULT_PUBLIC_PORT, 0, 65535);
        PUBLIC_SECURE =
                builder.comment(
                                "Generate connection codes for wss://.",
                                "Enable only when a TLS reverse proxy terminates this endpoint.",
                                "This setting changes connection codes; it does not enable TLS in the Connector.")
                        .define("publicSecure", false);
        ALLOW_REMOTE =
                builder.comment(
                                "Allow listening on a non-loopback address.",
                                "Remote connections use ws:// unless you provide a TLS reverse proxy.",
                                "Expose this port only to trusted networks.")
                        .define("allowRemote", DEFAULT_ALLOW_REMOTE);
        builder.pop();

        builder.comment("Authentication and server action settings.").push("permissions");
        ALLOW_RELOAD =
                builder.comment("Allow operator/admin clients to request a server_scripts reload.")
                        .define("allowReload", DEFAULT_ALLOW_RELOAD);
        JOIN_PERMISSION_LEVEL =
                builder.comment(
                                "Minimum Minecraft command permission level required for /kvs join.",
                                "0 = everyone, 2 = operators, 4 = administrators.",
                                "The singleplayer world owner can use /kvs join without cheats.")
                        .defineInRange(
                                "joinPermissionLevel", DEFAULT_JOIN_PERMISSION_LEVEL, 0, 4);
        DEFAULT_JOIN_ROLE =
                builder.comment(
                                "Role assigned when a player first uses /kvs join.",
                                "An administrator can change it with /kvs role <player> <role>.",
                                "Existing player accounts keep their assigned roles.")
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
