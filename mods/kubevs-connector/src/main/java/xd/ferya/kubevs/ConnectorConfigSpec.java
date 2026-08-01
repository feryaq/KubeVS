package xd.ferya.kubevs;

import net.neoforged.neoforge.common.ModConfigSpec;

final class ConnectorConfigSpec {
    static final String FILE_NAME = "kubevs-connector.toml";
    static final String DEFAULT_HOST = "127.0.0.1";
    static final int DEFAULT_PORT = 32145;
    static final boolean DEFAULT_ALLOW_REMOTE = false;
    static final boolean DEFAULT_ALLOW_RELOAD = false;
    static final int DEFAULT_JOIN_PERMISSION_LEVEL = 2;
    static final ModConfigSpec SPEC;

    static final ModConfigSpec.ConfigValue<String> HOST;
    static final ModConfigSpec.IntValue PORT;
    static final ModConfigSpec.BooleanValue ALLOW_REMOTE;
    static final ModConfigSpec.BooleanValue ALLOW_RELOAD;
    static final ModConfigSpec.IntValue JOIN_PERMISSION_LEVEL;

    static {
        ModConfigSpec.Builder builder = new ModConfigSpec.Builder();

        builder.comment("KubeVS Connector network settings.").push("network");
        HOST =
                builder.comment(
                                "Address to listen on.",
                                "Keep 127.0.0.1 for a local game.",
                                "For a dedicated server use its bind address or 0.0.0.0 and enable allowRemote.")
                        .define("host", DEFAULT_HOST, ConnectorConfigSpec::isValidHost);
        PORT =
                builder.comment("WebSocket port used by KubeVS and the VS Code extension.")
                        .defineInRange("port", DEFAULT_PORT, 1024, 65535);
        ALLOW_REMOTE =
                builder.comment(
                                "Allow listening on a non-loopback address.",
                                "Remote connections use ws://, so expose this port only to trusted networks.")
                        .define("allowRemote", DEFAULT_ALLOW_REMOTE);
        builder.pop();

        builder.comment("Authentication and server action settings.").push("permissions");
        ALLOW_RELOAD =
                builder.comment("Allow authenticated clients to reload server_scripts.")
                        .define("allowReload", DEFAULT_ALLOW_RELOAD);
        JOIN_PERMISSION_LEVEL =
                builder.comment(
                                "Minimum Minecraft command permission level required for /kvs join.",
                                "0 = everyone, 2 = operators, 4 = administrators.")
                        .defineInRange(
                                "joinPermissionLevel", DEFAULT_JOIN_PERMISSION_LEVEL, 0, 4);
        builder.pop();

        SPEC = builder.build();
    }

    private ConnectorConfigSpec() {}

    private static boolean isValidHost(Object value) {
        if (!(value instanceof String host)) {
            return false;
        }
        String trimmed = host.trim();
        return !trimmed.isEmpty() && trimmed.length() <= 255 && !trimmed.chars().anyMatch(Character::isWhitespace);
    }
}
