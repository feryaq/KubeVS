package xd.ferya.kubevs;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

final class WorkspaceLockManagerTest {
    private static final WorkspaceLockManager.Owner ALICE =
            new WorkspaceLockManager.Owner("session-a", "Alice");
    private static final WorkspaceLockManager.Owner BOB =
            new WorkspaceLockManager.Owner("session-b", "Bob");

    @Test
    void preventsAnotherSessionFromTakingOrReleasingTheLock() {
        WorkspaceLockManager locks = new WorkspaceLockManager();

        assertEquals(ALICE, locks.acquire("server_scripts/main.js", ALICE).owner());
        assertEquals(ALICE, locks.acquire("server_scripts/main.js", BOB).owner());
        assertTrue(locks.isOwnedBy("server_scripts/main.js", ALICE));
        assertFalse(locks.isOwnedBy("server_scripts/main.js", BOB));
        assertFalse(locks.release("server_scripts/main.js", BOB));
        assertTrue(locks.release("server_scripts/main.js", ALICE));
    }

    @Test
    void releasesEveryLockOwnedByDisconnectedSession() {
        WorkspaceLockManager locks = new WorkspaceLockManager();
        locks.acquire("server_scripts/a.js", ALICE);
        locks.acquire("server_scripts/b.js", ALICE);
        locks.acquire("server_scripts/c.js", BOB);

        assertEquals(2, locks.releaseAll(ALICE));
        assertEquals(1, locks.list().size());
        assertEquals(BOB, locks.list().getFirst().owner());
    }
}
