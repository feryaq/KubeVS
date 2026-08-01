package xd.ferya.kubevs;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.SecureRandom;
import java.util.Base64;

final class TokenStore {
    private static final SecureRandom RANDOM = new SecureRandom();

    private TokenStore() {}

    static String loadOrCreate(Path path) throws IOException {
        if (Files.exists(path)) {
            String existing = Files.readString(path, StandardCharsets.UTF_8).trim();
            if (!isValid(existing)) {
                throw new IOException("KubeVS token file contains an invalid token: " + path);
            }
            return existing;
        }

        return rotate(path);
    }

    static String rotate(Path path) throws IOException {
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        writeAtomically(path, token);
        return token;
    }

    private static void writeAtomically(Path path, String token) throws IOException {
        Files.createDirectories(path.getParent());
        Path temporary = path.resolveSibling(path.getFileName() + ".tmp");
        Files.writeString(temporary, token + System.lineSeparator(), StandardCharsets.UTF_8);
        try {
            Files.move(
                    temporary,
                    path,
                    StandardCopyOption.ATOMIC_MOVE,
                    StandardCopyOption.REPLACE_EXISTING);
        } catch (IOException unsupportedAtomicMove) {
            Files.move(temporary, path, StandardCopyOption.REPLACE_EXISTING);
        }
    }

    static boolean isValid(String token) {
        if (token == null) {
            return false;
        }
        return token.length() >= 32
                && token.length() <= 256
                && token.chars().allMatch(character ->
                        character >= 'A' && character <= 'Z'
                                || character >= 'a' && character <= 'z'
                                || character >= '0' && character <= '9'
                                || character == '_'
                                || character == '-');
    }
}
