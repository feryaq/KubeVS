package xd.ferya.kubevs;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Path;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

final class PlayerTokenStoreTest {
    @TempDir
    Path temporaryDirectory;

    @Test
    void issuesStableCredentialBoundToPlayerAndReloadsIt() throws Exception {
        Path path = temporaryDirectory.resolve("player-tokens.tsv");
        UUID playerId = UUID.randomUUID();
        PlayerTokenStore store = PlayerTokenStore.load(path);

        PlayerTokenStore.Credential first = store.issue(playerId, "Builder", 2);
        PlayerTokenStore.Credential second = store.issue(playerId, "Builder", 2);

        assertEquals(first.token(), second.token());
        assertTrue(TokenStore.isValid(first.token()));
        PlayerTokenStore reloaded = PlayerTokenStore.load(path);
        assertEquals("Builder", reloaded.authenticate(first.token()).orElseThrow().playerName());
        assertEquals(playerId, reloaded.authenticate(first.token()).orElseThrow().playerId());
        assertEquals(2, reloaded.authenticate(first.token()).orElseThrow().permissionLevel());
    }

    @Test
    void rotatesCredentialWhenPlayerNameChangesAndCanRevokeIt() throws Exception {
        Path path = temporaryDirectory.resolve("player-tokens.tsv");
        UUID playerId = UUID.randomUUID();
        PlayerTokenStore store = PlayerTokenStore.load(path);
        String oldToken = store.issue(playerId, "OldName", 2).token();
        String newToken = store.issue(playerId, "NewName", 2).token();

        assertNotEquals(oldToken, newToken);
        assertFalse(store.authenticate(oldToken).isPresent());
        assertTrue(store.authenticate(newToken).isPresent());
        assertTrue(store.revoke(playerId));
        assertFalse(store.authenticate(newToken).isPresent());
        assertFalse(store.revoke(playerId));
    }

    @Test
    void rejectsMalformedTokensWithoutMatching() throws Exception {
        PlayerTokenStore store =
                PlayerTokenStore.load(temporaryDirectory.resolve("player-tokens.tsv"));
        store.issue(UUID.randomUUID(), "Builder", 2);

        assertFalse(store.authenticate(null).isPresent());
        assertFalse(store.authenticate("short").isPresent());
        assertFalse(store.authenticate("!".repeat(43)).isPresent());
    }

    @Test
    void loadsLegacyCredentialWithMinimumPermission() throws Exception {
        Path path = temporaryDirectory.resolve("legacy.tsv");
        UUID playerId = UUID.randomUUID();
        String token = "A".repeat(43);
        String encodedName = java.util.Base64.getUrlEncoder()
                .withoutPadding()
                .encodeToString("Legacy".getBytes(java.nio.charset.StandardCharsets.UTF_8));
        java.nio.file.Files.writeString(
                path, playerId + "\t" + encodedName + "\t" + token + System.lineSeparator());

        PlayerTokenStore.Credential credential =
                PlayerTokenStore.load(path).authenticate(token).orElseThrow();
        assertEquals(0, credential.permissionLevel());
    }

    @Test
    void rotatesTokenWhenPermissionChanges() throws Exception {
        PlayerTokenStore store =
                PlayerTokenStore.load(temporaryDirectory.resolve("permissions.tsv"));
        UUID playerId = UUID.randomUUID();
        String oldToken = store.issue(playerId, "Builder", 2).token();
        PlayerTokenStore.Credential elevated = store.issue(playerId, "Builder", 3);

        assertNotEquals(oldToken, elevated.token());
        assertEquals(3, elevated.permissionLevel());
        assertFalse(store.authenticate(oldToken).isPresent());
    }
}
