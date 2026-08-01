package xd.ferya.kubevs;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

final class ConnectorPermissionsTest {
    @Test
    void levelZeroCannotReadServerFiles() {
        assertFalse(ConnectorPermissions.allows(0, ConnectorPermissions.READ_WORKSPACE));
        assertFalse(ConnectorPermissions.allows(0, ConnectorPermissions.EDIT_WORKSPACE));
    }

    @Test
    void levelOneIsReadOnly() {
        assertTrue(ConnectorPermissions.allows(1, ConnectorPermissions.READ_WORKSPACE));
        assertFalse(ConnectorPermissions.allows(1, ConnectorPermissions.EDIT_WORKSPACE));
        assertFalse(ConnectorPermissions.allows(1, ConnectorPermissions.READ_LOGS));
    }

    @Test
    void levelTwoCanEditReadLogsAndReload() {
        assertTrue(ConnectorPermissions.allows(2, ConnectorPermissions.EDIT_WORKSPACE));
        assertTrue(ConnectorPermissions.allows(2, ConnectorPermissions.READ_LOGS));
        assertTrue(ConnectorPermissions.allows(2, ConnectorPermissions.RELOAD_SERVER));
    }
}
