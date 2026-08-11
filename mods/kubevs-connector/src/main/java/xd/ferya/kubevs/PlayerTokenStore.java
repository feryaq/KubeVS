package xd.ferya.kubevs;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * Persistent per-player accounts. Only SHA-256 token digests are stored on disk; a raw token is
 * shown once when /kvs join rotates it.
 */
final class PlayerTokenStore {
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final Base64.Encoder TOKEN_ENCODER = Base64.getUrlEncoder().withoutPadding();
    private static final Base64.Encoder TEXT_ENCODER = Base64.getUrlEncoder().withoutPadding();
    private static final Base64.Decoder TEXT_DECODER = Base64.getUrlDecoder();

    record Credential(UUID playerId, String playerName, ConnectorRole role, String token) {}

    record Account(UUID playerId, String playerName, ConnectorRole role) {}

    private record StoredAccount(
            UUID playerId, String playerName, ConnectorRole role, byte[] tokenDigest) {
        StoredAccount {
            tokenDigest = tokenDigest.clone();
        }

        Account publicView() {
            return new Account(playerId, playerName, role);
        }
    }

    private final Path path;
    private final Map<UUID, StoredAccount> accounts = new LinkedHashMap<>();

    private PlayerTokenStore(Path path) {
        this.path = path;
    }

    static PlayerTokenStore load(Path path) throws IOException {
        PlayerTokenStore store = new PlayerTokenStore(path);
        if (!Files.exists(path)) {
            return store;
        }

        boolean migrated = false;
        int lineNumber = 0;
        for (String line : Files.readAllLines(path, StandardCharsets.UTF_8)) {
            lineNumber++;
            if (line.isBlank() || line.startsWith("#")) {
                continue;
            }
            String[] fields = line.split("\t", -1);
            try {
                if (fields.length != 3 && fields.length != 4) {
                    throw new IllegalArgumentException("invalid account");
                }
                UUID playerId = UUID.fromString(fields[0]);
                String playerName =
                        new String(TEXT_DECODER.decode(fields[1]), StandardCharsets.UTF_8);
                validatePlayerName(playerName);

                ConnectorRole role;
                String secret;
                boolean digestStored = false;
                if (fields.length == 3) {
                    role = ConnectorRole.VIEWER;
                    secret = fields[2];
                    migrated = true;
                } else if (fields[2].matches("[0-4]")) {
                    role = ConnectorRole.fromLegacyLevel(Integer.parseInt(fields[2]));
                    secret = fields[3];
                    migrated = true;
                } else {
                    role = ConnectorRole.parse(fields[2]);
                    secret = fields[3];
                    digestStored = secret.matches("[0-9a-fA-F]{64}");
                }

                byte[] digest;
                if (digestStored) {
                    digest = HexFormat.of().parseHex(secret);
                } else {
                    if (!TokenStore.isValid(secret)) {
                        throw new IllegalArgumentException("invalid token");
                    }
                    digest = digest(secret);
                    migrated = true;
                }
                store.accounts.put(
                        playerId, new StoredAccount(playerId, playerName, role, digest));
            } catch (RuntimeException exception) {
                throw new IOException(
                        "Invalid KubeVS account entry at " + path + ":" + lineNumber,
                        exception);
            }
        }
        if (migrated) {
            store.write();
        }
        return store;
    }

    synchronized Credential issue(
            UUID playerId, String playerName, ConnectorRole defaultRole) throws IOException {
        validatePlayerName(playerName);
        StoredAccount existing = accounts.get(playerId);
        ConnectorRole role = existing == null ? defaultRole : existing.role();

        byte[] random = new byte[32];
        RANDOM.nextBytes(random);
        String token = TOKEN_ENCODER.encodeToString(random);
        accounts.put(
                playerId,
                new StoredAccount(playerId, playerName, role, digest(token)));
        write();
        return new Credential(playerId, playerName, role, token);
    }

    synchronized Optional<Account> authenticate(String token) {
        if (!TokenStore.isValid(token)) {
            return Optional.empty();
        }
        byte[] candidate = digest(token);
        for (StoredAccount account : accounts.values()) {
            if (MessageDigest.isEqual(account.tokenDigest(), candidate)) {
                return Optional.of(account.publicView());
            }
        }
        return Optional.empty();
    }

    synchronized Optional<Account> setRole(String playerName, ConnectorRole role)
            throws IOException {
        StoredAccount account = findStored(playerName).orElse(null);
        if (account == null) {
            return Optional.empty();
        }
        StoredAccount updated =
                new StoredAccount(account.playerId(), account.playerName(), role, account.tokenDigest());
        accounts.put(updated.playerId(), updated);
        write();
        return Optional.of(updated.publicView());
    }

    synchronized boolean revoke(UUID playerId) throws IOException {
        if (accounts.remove(playerId) == null) {
            return false;
        }
        write();
        return true;
    }

    synchronized boolean revoke(String playerName) throws IOException {
        Optional<StoredAccount> account = findStored(playerName);
        if (account.isEmpty()) {
            return false;
        }
        accounts.remove(account.orElseThrow().playerId());
        write();
        return true;
    }

    synchronized List<Account> list() {
        return accounts.values().stream()
                .map(StoredAccount::publicView)
                .sorted(Comparator.comparing(
                        Account::playerName, String.CASE_INSENSITIVE_ORDER))
                .toList();
    }

    synchronized int size() {
        return accounts.size();
    }

    private Optional<StoredAccount> findStored(String playerName) {
        String normalized = playerName.toLowerCase(Locale.ROOT);
        return accounts.values().stream()
                .filter(account -> account.playerName().toLowerCase(Locale.ROOT).equals(normalized))
                .findFirst();
    }

    private void write() throws IOException {
        Path parent = path.getParent();
        if (parent != null) {
            Files.createDirectories(parent);
        }
        List<String> lines = new ArrayList<>();
        lines.add("# KubeVS accounts v3: uuid, base64 name, role, SHA-256 token digest.");
        for (StoredAccount account : accounts.values()) {
            String encodedName = TEXT_ENCODER.encodeToString(
                    account.playerName().getBytes(StandardCharsets.UTF_8));
            lines.add(
                    account.playerId()
                            + "\t"
                            + encodedName
                            + "\t"
                            + account.role().id()
                            + "\t"
                            + HexFormat.of().formatHex(account.tokenDigest()));
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

    private static byte[] digest(String token) {
        try {
            return MessageDigest.getInstance("SHA-256")
                    .digest(token.getBytes(StandardCharsets.UTF_8));
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException("SHA-256 is unavailable", impossible);
        }
    }

    private static void validatePlayerName(String playerName) {
        if (playerName == null || playerName.isBlank() || playerName.length() > 64) {
            throw new IllegalArgumentException("invalid player name");
        }
    }
}
