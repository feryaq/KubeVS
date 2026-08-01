package xd.ferya.kubevs;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * Persistent per-player credentials. Tokens are never derived from a player name or UUID and are
 * compared in constant time.
 */
final class PlayerTokenStore {
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final Base64.Encoder TOKEN_ENCODER = Base64.getUrlEncoder().withoutPadding();
    private static final Base64.Encoder TEXT_ENCODER = Base64.getUrlEncoder().withoutPadding();
    private static final Base64.Decoder TEXT_DECODER = Base64.getUrlDecoder();

    record Credential(UUID playerId, String playerName, int permissionLevel, String token) {}

    private final Path path;
    private final Map<UUID, Credential> credentials = new LinkedHashMap<>();

    private PlayerTokenStore(Path path) {
        this.path = path;
    }

    static PlayerTokenStore load(Path path) throws IOException {
        PlayerTokenStore store = new PlayerTokenStore(path);
        if (!Files.exists(path)) {
            return store;
        }

        int lineNumber = 0;
        for (String line : Files.readAllLines(path, StandardCharsets.UTF_8)) {
            lineNumber++;
            if (line.isBlank() || line.startsWith("#")) {
                continue;
            }
            String[] fields = line.split("\t", -1);
            try {
                if (fields.length != 3 && fields.length != 4) {
                    throw new IllegalArgumentException("invalid credential");
                }
                int permissionLevel = fields.length == 4 ? Integer.parseInt(fields[2]) : 0;
                String token = fields.length == 4 ? fields[3] : fields[2];
                validatePermissionLevel(permissionLevel);
                if (!TokenStore.isValid(token)) {
                    throw new IllegalArgumentException("invalid token");
                }
                UUID playerId = UUID.fromString(fields[0]);
                String playerName =
                        new String(TEXT_DECODER.decode(fields[1]), StandardCharsets.UTF_8);
                if (playerName.isBlank() || playerName.length() > 64) {
                    throw new IllegalArgumentException("invalid player name");
                }
                store.credentials.put(
                        playerId,
                        new Credential(playerId, playerName, permissionLevel, token));
            } catch (RuntimeException exception) {
                throw new IOException(
                        "Invalid KubeVS player token entry at " + path + ":" + lineNumber,
                        exception);
            }
        }
        return store;
    }

    synchronized Credential issue(UUID playerId, String playerName, int permissionLevel)
            throws IOException {
        validatePermissionLevel(permissionLevel);
        Credential existing = credentials.get(playerId);
        if (existing != null
                && existing.playerName().equals(playerName)
                && existing.permissionLevel() == permissionLevel) {
            return existing;
        }

        byte[] random = new byte[32];
        RANDOM.nextBytes(random);
        Credential credential =
                new Credential(
                        playerId,
                        playerName,
                        permissionLevel,
                        TOKEN_ENCODER.encodeToString(random));
        credentials.put(playerId, credential);
        write();
        return credential;
    }

    synchronized Optional<Credential> authenticate(String token) {
        if (!TokenStore.isValid(token)) {
            return Optional.empty();
        }
        byte[] candidate = token.getBytes(StandardCharsets.UTF_8);
        for (Credential credential : credentials.values()) {
            if (MessageDigest.isEqual(
                    credential.token().getBytes(StandardCharsets.UTF_8), candidate)) {
                return Optional.of(credential);
            }
        }
        return Optional.empty();
    }

    synchronized boolean revoke(UUID playerId) throws IOException {
        if (credentials.remove(playerId) == null) {
            return false;
        }
        write();
        return true;
    }

    synchronized int size() {
        return credentials.size();
    }

    private void write() throws IOException {
        Path parent = path.getParent();
        if (parent != null) {
            Files.createDirectories(parent);
        }
        List<String> lines = new ArrayList<>();
        lines.add("# KubeVS per-player credentials v2. Keep this file secret.");
        for (Credential credential : credentials.values()) {
            String encodedName = TEXT_ENCODER.encodeToString(
                    credential.playerName().getBytes(StandardCharsets.UTF_8));
            lines.add(
                    credential.playerId()
                            + "\t"
                            + encodedName
                            + "\t"
                            + credential.permissionLevel()
                            + "\t"
                            + credential.token());
        }

        Path temporary = path.resolveSibling(path.getFileName() + ".tmp");
        Files.write(temporary, lines, StandardCharsets.UTF_8);
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

    private static void validatePermissionLevel(int permissionLevel) {
        if (permissionLevel < 0 || permissionLevel > 4) {
            throw new IllegalArgumentException("Permission level must be between 0 and 4");
        }
    }
}
