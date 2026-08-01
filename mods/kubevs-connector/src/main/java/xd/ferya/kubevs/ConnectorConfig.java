package xd.ferya.kubevs;

import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.UnknownHostException;
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
        int joinPermissionLevel = ConnectorConfigSpec.JOIN_PERMISSION_LEVEL.get();

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
                joinPermissionLevel,
                1_048_576,
                30,
                10_000);
    }

    String publicHost() {
        return address.getAddress().getHostAddress();
    }
}
