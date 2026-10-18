package xd.ferya.kubevs;

import static org.junit.jupiter.api.Assertions.*;
import org.junit.jupiter.api.Test;

final class ReloadPolicyTest {
    @Test
    void onlyAdministratorsCanPersistPolicyChanges() {
        ReloadPolicy policy = new ReloadPolicy(false);
        for (ConnectorRole role : new ConnectorRole[]{ConnectorRole.VIEWER, ConnectorRole.EDITOR, ConnectorRole.OPERATOR}) {
            assertThrows(IllegalArgumentException.class, () -> policy.update(role, true, value -> fail("must not save")));
            assertFalse(policy.enabled());
        }
        policy.update(ConnectorRole.ADMIN, true, value -> assertTrue(value));
        assertTrue(policy.enabled());
        policy.update(ConnectorRole.ADMIN, false, value -> assertFalse(value));
        assertFalse(policy.enabled());
    }

    @Test
    void failedPersistenceDoesNotEnableReload() {
        ReloadPolicy policy = new ReloadPolicy(false);
        assertThrows(IllegalStateException.class, () -> policy.update(ConnectorRole.ADMIN, true, value -> {throw new IllegalStateException("disk failure");}));
        assertFalse(policy.enabled());
    }
}
