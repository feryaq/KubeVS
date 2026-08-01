package xd.ferya.kubevs;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.stream.Stream;

/**
 * Sandboxed text-file access for the server's kubejs directory.
 */
final class WorkspaceFileService {
    static final int DEFAULT_MAX_FILE_BYTES = 1_048_576;
    static final int DEFAULT_MAX_LIST_ENTRIES = 2_000;
    private static final long MAX_LIST_HASH_BYTES = 67_108_864L;

    record FileEntry(String path, long size, String revision) {}

    record FileContent(String path, String content, String revision) {}

    static final class RevisionConflictException extends IOException {
        private final String actualRevision;

        RevisionConflictException(String actualRevision) {
            super("File revision does not match");
            this.actualRevision = actualRevision;
        }

        String actualRevision() {
            return actualRevision;
        }
    }

    private final Path root;
    private final int maxFileBytes;
    private final int maxListEntries;

    WorkspaceFileService(Path root) throws IOException {
        this(root, DEFAULT_MAX_FILE_BYTES, DEFAULT_MAX_LIST_ENTRIES);
    }

    WorkspaceFileService(Path root, int maxFileBytes, int maxListEntries) throws IOException {
        if (maxFileBytes < 1 || maxListEntries < 1) {
            throw new IllegalArgumentException("Workspace limits must be positive");
        }
        Files.createDirectories(root);
        this.root = root.toRealPath();
        this.maxFileBytes = maxFileBytes;
        this.maxListEntries = maxListEntries;
    }

    List<FileEntry> list() throws IOException {
        List<FileEntry> result = new ArrayList<>();
        long hashedBytes = 0;
        try (Stream<Path> paths = Files.walk(root)) {
            var iterator = paths.iterator();
            while (iterator.hasNext()) {
                Path path = iterator.next();
                if (path.equals(root) || Files.isSymbolicLink(path)) {
                    continue;
                }
                verifyRealContainment(path);
                if (!Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS)) {
                    continue;
                }
                if (result.size() >= maxListEntries) {
                    throw new IOException("Workspace contains too many files");
                }
                long size = Files.size(path);
                if (size > maxFileBytes) {
                    continue;
                }
                hashedBytes += size;
                if (hashedBytes > MAX_LIST_HASH_BYTES) {
                    throw new IOException("Workspace listing exceeds the hashing budget");
                }
                byte[] bytes = Files.readAllBytes(path);
                result.add(new FileEntry(relative(path), size, revision(bytes)));
            }
        }
        result.sort(Comparator.comparing(FileEntry::path));
        return List.copyOf(result);
    }

    FileContent read(String relativePath) throws IOException {
        Path target = resolveExisting(relativePath);
        if (!Files.isRegularFile(target, LinkOption.NOFOLLOW_LINKS)) {
            throw new IOException("Workspace path is not a regular file");
        }
        long size = Files.size(target);
        if (size > maxFileBytes) {
            throw new IOException("Workspace file exceeds the size limit");
        }
        byte[] bytes = Files.readAllBytes(target);
        return new FileContent(relative(target), new String(bytes, StandardCharsets.UTF_8), revision(bytes));
    }

    synchronized FileContent write(String relativePath, String content, String expectedRevision)
            throws IOException {
        Objects.requireNonNull(content, "content");
        Objects.requireNonNull(expectedRevision, "expectedRevision");
        byte[] bytes = content.getBytes(StandardCharsets.UTF_8);
        if (bytes.length > maxFileBytes) {
            throw new IOException("Workspace file exceeds the size limit");
        }

        Path target = resolveForWrite(relativePath);
        String actualRevision = "";
        if (Files.exists(target, LinkOption.NOFOLLOW_LINKS)) {
            if (Files.isSymbolicLink(target)
                    || !Files.isRegularFile(target, LinkOption.NOFOLLOW_LINKS)) {
                throw new IOException("Workspace path is not a regular file");
            }
            byte[] current = Files.readAllBytes(target);
            if (current.length > maxFileBytes) {
                throw new IOException("Workspace file exceeds the size limit");
            }
            actualRevision = revision(current);
        }
        if (!MessageDigest.isEqual(
                expectedRevision.getBytes(StandardCharsets.UTF_8),
                actualRevision.getBytes(StandardCharsets.UTF_8))) {
            throw new RevisionConflictException(actualRevision);
        }

        Files.createDirectories(target.getParent());
        verifyRealContainment(target.getParent());
        Path temporary = Files.createTempFile(target.getParent(), ".kubevs-", ".tmp");
        try {
            Files.write(temporary, bytes);
            try {
                Files.move(
                        temporary,
                        target,
                        StandardCopyOption.ATOMIC_MOVE,
                        StandardCopyOption.REPLACE_EXISTING);
            } catch (IOException unsupportedAtomicMove) {
                Files.move(temporary, target, StandardCopyOption.REPLACE_EXISTING);
            }
        } finally {
            Files.deleteIfExists(temporary);
        }
        return new FileContent(relative(target), content, revision(bytes));
    }

    String canonicalKey(String relativePath) throws IOException {
        Path target = resolveForWrite(relativePath);
        String key = relative(Files.exists(target, LinkOption.NOFOLLOW_LINKS)
                ? target.toRealPath()
                : target);
        return root.getFileSystem().getSeparator().equals("\\")
                ? key.toLowerCase(Locale.ROOT)
                : key;
    }

    private Path resolveExisting(String relativePath) throws IOException {
        Path target = resolveLexically(relativePath);
        if (!Files.exists(target, LinkOption.NOFOLLOW_LINKS)) {
            throw new IOException("Workspace file does not exist");
        }
        if (Files.isSymbolicLink(target)) {
            throw new IOException("Symbolic links are not allowed");
        }
        verifyRealContainment(target);
        return target;
    }

    private Path resolveForWrite(String relativePath) throws IOException {
        Path target = resolveLexically(relativePath);
        Path cursor = target;
        while (cursor != null && !Files.exists(cursor, LinkOption.NOFOLLOW_LINKS)) {
            cursor = cursor.getParent();
        }
        if (cursor == null || Files.isSymbolicLink(cursor)) {
            throw new IOException("Unsafe workspace path");
        }
        verifyRealContainment(cursor);
        return target;
    }

    private Path resolveLexically(String relativePath) throws IOException {
        if (relativePath == null || relativePath.isBlank() || relativePath.indexOf('\0') >= 0) {
            throw new IOException("Workspace path is required");
        }
        Path supplied;
        try {
            supplied = Path.of(relativePath);
        } catch (RuntimeException exception) {
            throw new IOException("Invalid workspace path", exception);
        }
        if (supplied.isAbsolute()) {
            throw new IOException("Absolute workspace paths are not allowed");
        }
        Path target = root.resolve(supplied).normalize();
        if (target.equals(root) || !target.startsWith(root)) {
            throw new IOException("Workspace path escapes the kubejs directory");
        }
        return target;
    }

    private void verifyRealContainment(Path path) throws IOException {
        Path real = path.toRealPath();
        if (!real.startsWith(root)) {
            throw new IOException("Workspace path escapes through a symbolic link");
        }
    }

    private String relative(Path path) {
        return root.relativize(path.toAbsolutePath().normalize())
                .toString()
                .replace('\\', '/');
    }

    private static String revision(byte[] bytes) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException("SHA-256 is unavailable", impossible);
        }
    }
}
