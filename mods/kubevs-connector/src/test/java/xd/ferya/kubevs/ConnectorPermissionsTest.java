package xd.ferya.kubevs;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

final class ConnectorPermissionsTest {
    @Test
    void viewerIsStrictlyReadOnly() {
        assertTrue(ConnectorPermissions.allows(
                ConnectorRole.VIEWER, ConnectorPermissions.WORKSPACE_READ));
        assertFalse(ConnectorPermissions.allows(
                ConnectorRole.VIEWER, ConnectorPermissions.WORKSPACE_WRITE));
        assertFalse(ConnectorPermissions.allows(
                ConnectorRole.VIEWER, ConnectorPermissions.LOGS_READ));
    }

    @Test
    void editorCanManageFilesButCannotOperateServer() {
        assertTrue(ConnectorPermissions.allows(
                ConnectorRole.EDITOR, ConnectorPermissions.WORKSPACE_WRITE));
        assertTrue(ConnectorPermissions.allows(
                ConnectorRole.EDITOR, ConnectorPermissions.WORKSPACE_MANAGE));
        assertFalse(ConnectorPermissions.allows(
                ConnectorRole.EDITOR, ConnectorPermissions.RELOAD_SERVER));
    }

    @Test
    void operatorAndAdminHaveExplicitElevatedPermissions() {
        assertTrue(ConnectorPermissions.allows(
                ConnectorRole.OPERATOR, ConnectorPermissions.RELOAD_SERVER));
        assertFalse(ConnectorPermissions.allows(
                ConnectorRole.OPERATOR, ConnectorPermissions.ACCOUNTS_MANAGE));
        assertTrue(ConnectorPermissions.allows(
                ConnectorRole.ADMIN, ConnectorPermissions.ACCOUNTS_MANAGE));
    }
}
