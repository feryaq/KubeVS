package xd.ferya.kubevs;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class TokenStoreTest {
    @Test
    void createsAndReusesStrongToken(@TempDir Path directory) throws Exception {
        Path path = directory.resolve("token.txt");
        String created = TokenStore.loadOrCreate(path);
        assertTrue(created.length() >= 43);
        assertEquals(created, TokenStore.loadOrCreate(path));
    }

    @Test
    void rotatesTokenAtomically(@TempDir Path directory) throws Exception {
        Path path = directory.resolve("token.txt");
        String previous = TokenStore.loadOrCreate(path);
        String rotated = TokenStore.rotate(path);

        assertNotEquals(previous, rotated);
        assertEquals(rotated, Files.readString(path, StandardCharsets.UTF_8).trim());
        assertEquals(rotated, TokenStore.loadOrCreate(path));
    }

    @Test
    void rejectsMalformedExistingToken(@TempDir Path directory) throws Exception {
        Path path = directory.resolve("token.txt");
        Files.writeString(path, "this token contains spaces and must fail", StandardCharsets.UTF_8);

        assertThrows(IOException.class, () -> TokenStore.loadOrCreate(path));
    }
}
