package xd.ferya.kubevs;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;

import org.junit.jupiter.api.Test;

final class ConnectorConfigSpecTest {
    @Test
    void rejectsSharingTheMinecraftTcpPort() {
        assertThrows(
                IllegalStateException.class,
                () -> ConnectorConfig.requireDedicatedPort(20001, 20001));
        ConnectorConfig.requireDedicatedPort(32145, 25565);
    }

    @Test
    void exposesSafeDefaultsInTheNeoForgeConfig() {
        assertEquals("kubevs-connector.toml", ConnectorConfigSpec.FILE_NAME);
        assertEquals("127.0.0.1", ConnectorConfigSpec.DEFAULT_HOST);
        assertEquals(32145, ConnectorConfigSpec.DEFAULT_PORT);
        assertEquals("", ConnectorConfigSpec.DEFAULT_PUBLIC_HOST);
        assertEquals(0, ConnectorConfigSpec.DEFAULT_PUBLIC_PORT);
        assertFalse(ConnectorConfigSpec.DEFAULT_ALLOW_REMOTE);
        assertFalse(ConnectorConfigSpec.DEFAULT_ALLOW_RELOAD);
        assertEquals(2, ConnectorConfigSpec.DEFAULT_JOIN_PERMISSION_LEVEL);
    }
}
