package xd.ferya.kubevs;

import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.nio.file.Path;
import net.neoforged.fml.loading.FMLPaths;

record ConnectorConfig(
        InetSocketAddress address,
        String token,
        Path tokenFile,
        PlayerTokenStore playerTokens,
        Path playerTokenFile,
        boolean allowReload,
        boolean allowRemote,
        int joinPermissionLevel,
        ConnectorRole defaultJoinRole,
        String advertisedHost,
        int advertisedPort,
        boolean advertisedSecure,
        int maxMessageChars,
        int requestsPerWindow,
        long rateWindowMillis) {
    static ConnectorConfig load() throws Exception {
        String host = ConnectorConfigSpec.HOST.get().trim();
        InetAddress address = InetAddress.getByName(host);
        boolean allowRemote = ConnectorConfigSpec.ALLOW_REMOTE.get();
        if (!address.isLoopbackAddress() && !allowRemote) {
            throw new IllegalStateException(
                    "Refusing non-loopback bind while network.allowRemote is false in "
                            + ConnectorConfigSpec.FILE_NAME);
        }

        int port = ConnectorConfigSpec.PORT.get();
        int advertisedPort = ConnectorConfigSpec.PUBLIC_PORT.get() == 0
                ? port
                : ConnectorConfigSpec.PUBLIC_PORT.get();
        String advertisedHost = ConnectorConfigSpec.PUBLIC_HOST.get().trim();
        if (advertisedHost.isEmpty() && address.isAnyLocalAddress()) {
            throw new IllegalStateException(
                    "network.publicHost is required when network.host binds to all interfaces");
        }
        if (advertisedHost.isEmpty()) {
            advertisedHost = address.getHostAddress();
        }

        Path tokenFile = FMLPaths.CONFIGDIR.get().resolve("kubevs-connector-token.txt");
        Path playerTokenFile = FMLPaths.CONFIGDIR.get().resolve("kubevs-player-tokens.tsv");
        return new ConnectorConfig(
                new InetSocketAddress(address, port),
                TokenStore.loadOrCreate(tokenFile),
                tokenFile,
                PlayerTokenStore.load(playerTokenFile),
                playerTokenFile,
                ConnectorConfigSpec.ALLOW_RELOAD.get(),
                allowRemote,
                ConnectorConfigSpec.JOIN_PERMISSION_LEVEL.get(),
                ConnectorConfigSpec.DEFAULT_JOIN_ROLE.get(),
                advertisedHost,
                advertisedPort,
                ConnectorConfigSpec.PUBLIC_SECURE.get(),
                8_388_608,
                30,
                10_000);
    }

    static void requireDedicatedPort(int connectorPort, int minecraftPort) {
        if (connectorPort == minecraftPort) {
            throw new IllegalStateException(
                    "KubeVS Connector cannot share Minecraft TCP port "
                            + minecraftPort
                            + ". Allocate a separate TCP port in the hosting panel and set network.port to it.");
        }
    }

    String publicHost() {
        return advertisedHost;
    }

    int publicPort() {
        return advertisedPort;
    }
}
