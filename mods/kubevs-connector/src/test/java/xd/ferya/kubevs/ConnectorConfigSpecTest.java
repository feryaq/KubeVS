package xd.ferya.kubevs;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

import org.junit.jupiter.api.Test;

final class ConnectorConfigSpecTest {
    @Test
    void exposesSafeDefaultsInTheNeoForgeConfig() {
        assertEquals("kubevs-connector.toml", ConnectorConfigSpec.FILE_NAME);
        assertEquals("127.0.0.1", ConnectorConfigSpec.DEFAULT_HOST);
        assertEquals(32145, ConnectorConfigSpec.DEFAULT_PORT);
        assertFalse(ConnectorConfigSpec.DEFAULT_ALLOW_REMOTE);
        assertFalse(ConnectorConfigSpec.DEFAULT_ALLOW_RELOAD);
        assertEquals(2, ConnectorConfigSpec.DEFAULT_JOIN_PERMISSION_LEVEL);
    }
}
