package xd.ferya.kubevs;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Base64;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

final class PlayerTokenStoreTest {
    @TempDir
    Path temporaryDirectory;

    @Test
    void rotatesTokenAndStoresOnlyItsDigest() throws Exception {
        Path path = temporaryDirectory.resolve("accounts.tsv");
        UUID playerId = UUID.randomUUID();
        PlayerTokenStore store = PlayerTokenStore.load(path);

        PlayerTokenStore.Credential first =
                store.issue(playerId, "Builder", ConnectorRole.EDITOR);
        PlayerTokenStore.Credential second =
                store.issue(playerId, "Builder", ConnectorRole.EDITOR);

        assertNotEquals(first.token(), second.token());
        assertFalse(store.authenticate(first.token()).isPresent());
        assertEquals(
                ConnectorRole.EDITOR,
                store.authenticate(second.token()).orElseThrow().role());
        assertFalse(Files.readString(path).contains(second.token()));
    }

    @Test
    void roleChangesTakeEffectWithoutRotatingTheToken() throws Exception {
        PlayerTokenStore store =
                PlayerTokenStore.load(temporaryDirectory.resolve("roles.tsv"));
        PlayerTokenStore.Credential issued =
                store.issue(UUID.randomUUID(), "Builder", ConnectorRole.EDITOR);

        PlayerTokenStore.Account changed =
                store.setRole("builder", ConnectorRole.OPERATOR).orElseThrow();

        assertEquals(ConnectorRole.OPERATOR, changed.role());
        assertEquals(
                ConnectorRole.OPERATOR,
                store.authenticate(issued.token()).orElseThrow().role());
    }

    @Test
    void revokesAccountAndRejectsMalformedTokens() throws Exception {
        PlayerTokenStore store =
                PlayerTokenStore.load(temporaryDirectory.resolve("revoke.tsv"));
        PlayerTokenStore.Credential credential =
                store.issue(UUID.randomUUID(), "Builder", ConnectorRole.VIEWER);

        assertTrue(store.revoke("builder"));
        assertFalse(store.authenticate(credential.token()).isPresent());
        assertFalse(store.authenticate(null).isPresent());
        assertFalse(store.authenticate("short").isPresent());
    }

    @Test
    void migratesLegacyPlaintextCredentialToDigest() throws Exception {
        Path path = temporaryDirectory.resolve("legacy.tsv");
        UUID playerId = UUID.randomUUID();
        String token = "A".repeat(43);
        String encodedName = Base64.getUrlEncoder()
                .withoutPadding()
                .encodeToString("Legacy".getBytes(StandardCharsets.UTF_8));
        Files.writeString(path, playerId + "\t" + encodedName + "\t2\t" + token);

        PlayerTokenStore store = PlayerTokenStore.load(path);

        assertEquals(
                ConnectorRole.EDITOR,
                store.authenticate(token).orElseThrow().role());
        assertFalse(Files.readString(path).contains(token));
        assertTrue(Files.readString(path).contains("\teditor\t"));
    }
}
