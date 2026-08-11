package xd.ferya.kubevs;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.AccessDeniedException;
import java.nio.file.DirectoryNotEmptyException;
import java.nio.file.FileAlreadyExistsException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.NoSuchFileException;
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

/** Sandboxed filesystem access for the server's kubejs directory. */
final class WorkspaceFileService {
    static final int DEFAULT_MAX_FILE_BYTES = 4_194_304;
    static final int DEFAULT_MAX_LIST_ENTRIES = 10_000;
    private static final long MAX_LIST_HASH_BYTES = 67_108_864L;

    enum EntryType {
        FILE("file"),
        DIRECTORY("directory");

        private final String id;

        EntryType(String id) {
            this.id = id;
        }

        String id() {
            return id;
        }
    }

    record FileEntry(
            String path, EntryType type, long size, long mtime, String revision) {}

    record FileContent(
            String path,
            EntryType type,
            long size,
            long mtime,
            String revision,
            byte[] bytes) {
        FileContent {
            bytes = bytes.clone();
        }
    }

    static final class RevisionConflictException extends IOException {
        private final String actualRevision;

        RevisionConflictException(String actualRevision) {
            super("The file was changed by another collaborator");
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

    synchronized List<FileEntry> list() throws IOException {
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
                if (result.size() >= maxListEntries) {
                    throw new IOException("The kubejs workspace contains too many files");
                }
                if (Files.isDirectory(path, LinkOption.NOFOLLOW_LINKS)) {
                    result.add(entry(path, EntryType.DIRECTORY, new byte[0]));
                    continue;
                }
                if (!Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS)) {
                    continue;
                }
                long size = Files.size(path);
                if (size > maxFileBytes) {
                    continue;
                }
                hashedBytes += size;
                if (hashedBytes > MAX_LIST_HASH_BYTES) {
                    throw new IOException("The kubejs workspace indexing limit was exceeded");
                }
                byte[] bytes = Files.readAllBytes(path);
                result.add(entry(path, EntryType.FILE, bytes));
            }
        }
        result.sort(Comparator.comparing(FileEntry::path));
        return List.copyOf(result);
    }

    synchronized FileEntry stat(String relativePath) throws IOException {
        Path target = resolveExisting(relativePath);
        if (Files.isDirectory(target, LinkOption.NOFOLLOW_LINKS)) {
            return entry(target, EntryType.DIRECTORY, new byte[0]);
        }
        if (!Files.isRegularFile(target, LinkOption.NOFOLLOW_LINKS)) {
            throw new AccessDeniedException(relativePath, null, "Unsupported file type");
        }
        byte[] bytes = readLimited(target);
        return entry(target, EntryType.FILE, bytes);
    }

    synchronized FileContent read(String relativePath) throws IOException {
        Path target = resolveExisting(relativePath);
        if (!Files.isRegularFile(target, LinkOption.NOFOLLOW_LINKS)) {
            throw new AccessDeniedException(relativePath, null, "The path is not a regular file");
        }
        byte[] bytes = readLimited(target);
        FileEntry entry = entry(target, EntryType.FILE, bytes);
        return new FileContent(
                entry.path(),
                entry.type(),
                entry.size(),
                entry.mtime(),
                entry.revision(),
                bytes);
    }

    synchronized FileEntry write(String relativePath, String content, String expectedRevision)
            throws IOException {
        Objects.requireNonNull(content, "content");
        return write(relativePath, content.getBytes(StandardCharsets.UTF_8), expectedRevision);
    }

    synchronized FileEntry write(String relativePath, byte[] content, String expectedRevision)
            throws IOException {
        Objects.requireNonNull(content, "content");
        Objects.requireNonNull(expectedRevision, "expectedRevision");
        byte[] bytes = content.clone();
        if (bytes.length > maxFileBytes) {
            throw new AccessDeniedException(relativePath, null, "The file exceeds the size limit");
        }

        Path target = resolveForWrite(relativePath);
        ensureExistingParent(target);
        String actualRevision = "";
        if (Files.exists(target, LinkOption.NOFOLLOW_LINKS)) {
            if (Files.isSymbolicLink(target)
                    || !Files.isRegularFile(target, LinkOption.NOFOLLOW_LINKS)) {
                throw new AccessDeniedException(relativePath, null, "The path is not a regular file");
            }
            actualRevision = revision(readLimited(target));
        }
        requireRevision(expectedRevision, actualRevision);

        Path temporary = Files.createTempFile(target.getParent(), ".kubevs-", ".tmp");
        try {
            Files.write(temporary, bytes);
            moveReplacing(temporary, target);
        } finally {
            Files.deleteIfExists(temporary);
        }
        return entry(target, EntryType.FILE, bytes);
    }

    synchronized FileEntry createDirectory(String relativePath) throws IOException {
        Path target = resolveForWrite(relativePath);
        if (Files.exists(target, LinkOption.NOFOLLOW_LINKS)) {
            throw new FileAlreadyExistsException(relativePath);
        }
        ensureExistingParent(target);
        Files.createDirectory(target);
        return entry(target, EntryType.DIRECTORY, new byte[0]);
    }

    synchronized void delete(String relativePath, boolean recursive, String expectedRevision)
            throws IOException {
        Path target = resolveExisting(relativePath);
        if (Files.isRegularFile(target, LinkOption.NOFOLLOW_LINKS)) {
            requireRevision(expectedRevision, revision(readLimited(target)));
            Files.delete(target);
            return;
        }
        if (!Files.isDirectory(target, LinkOption.NOFOLLOW_LINKS)) {
            throw new AccessDeniedException(relativePath);
        }
        if (!recursive) {
            Files.delete(target);
            return;
        }
        try (Stream<Path> paths = Files.walk(target)) {
            for (Path path : paths.sorted(Comparator.reverseOrder()).toList()) {
                if (Files.isSymbolicLink(path)) {
                    Files.delete(path);
                } else {
                    verifyRealContainment(path);
                    Files.delete(path);
                }
            }
        }
    }

    synchronized void rename(
            String sourcePath,
            String destinationPath,
            boolean overwrite,
            String expectedRevision)
            throws IOException {
        Path source = resolveExisting(sourcePath);
        Path destination = resolveForWrite(destinationPath);
        if (destination.startsWith(source)) {
            throw new AccessDeniedException(destinationPath, null, "A directory cannot be moved into itself");
        }
        ensureExistingParent(destination);
        if (Files.isRegularFile(source, LinkOption.NOFOLLOW_LINKS)) {
            requireRevision(expectedRevision, revision(readLimited(source)));
        }
        if (Files.exists(destination, LinkOption.NOFOLLOW_LINKS)) {
            if (!overwrite) {
                throw new FileAlreadyExistsException(destinationPath);
            }
            deleteRecursively(destination);
        }
        try {
            Files.move(source, destination, StandardCopyOption.ATOMIC_MOVE);
        } catch (IOException unsupportedAtomicMove) {
            Files.move(source, destination);
        }
    }

    synchronized void copy(String sourcePath, String destinationPath, boolean overwrite)
            throws IOException {
        Path source = resolveExisting(sourcePath);
        Path destination = resolveForWrite(destinationPath);
        if (destination.startsWith(source)) {
            throw new AccessDeniedException(destinationPath, null, "A directory cannot be copied into itself");
        }
        ensureExistingParent(destination);
        if (Files.exists(destination, LinkOption.NOFOLLOW_LINKS)) {
            if (!overwrite) {
                throw new FileAlreadyExistsException(destinationPath);
            }
            deleteRecursively(destination);
        }
        if (Files.isRegularFile(source, LinkOption.NOFOLLOW_LINKS)) {
            readLimited(source);
            Files.copy(source, destination);
            return;
        }
        if (!Files.isDirectory(source, LinkOption.NOFOLLOW_LINKS)) {
            throw new AccessDeniedException(sourcePath);
        }

        try (Stream<Path> paths = Files.walk(source)) {
            for (Path current : paths.toList()) {
                if (Files.isSymbolicLink(current)) {
                    throw new AccessDeniedException(relative(current), null, "Symbolic links are not allowed");
                }
                verifyRealContainment(current);
                Path target = destination.resolve(source.relativize(current));
                if (Files.isDirectory(current, LinkOption.NOFOLLOW_LINKS)) {
                    Files.createDirectories(target);
                } else if (Files.isRegularFile(current, LinkOption.NOFOLLOW_LINKS)) {
                    readLimited(current);
                    Files.copy(current, target);
                }
            }
        }
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

    private FileEntry entry(Path path, EntryType type, byte[] bytes) throws IOException {
        return new FileEntry(
                relative(path),
                type,
                type == EntryType.FILE ? bytes.length : 0,
                Files.getLastModifiedTime(path, LinkOption.NOFOLLOW_LINKS).toMillis(),
                type == EntryType.FILE ? revision(bytes) : "");
    }

    private byte[] readLimited(Path target) throws IOException {
        long size = Files.size(target);
        if (size > maxFileBytes) {
            throw new AccessDeniedException(relative(target), null, "The file exceeds the size limit");
        }
        return Files.readAllBytes(target);
    }

    private Path resolveExisting(String relativePath) throws IOException {
        Path target = resolveLexically(relativePath);
        if (!Files.exists(target, LinkOption.NOFOLLOW_LINKS)) {
            throw new NoSuchFileException(relativePath);
        }
        if (Files.isSymbolicLink(target)) {
            throw new AccessDeniedException(relativePath, null, "Symbolic links are not allowed");
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
            throw new AccessDeniedException(relativePath, null, "Unsafe path");
        }
        verifyRealContainment(cursor);
        return target;
    }

    private Path resolveLexically(String relativePath) throws IOException {
        if (relativePath == null || relativePath.isBlank() || relativePath.indexOf('\0') >= 0) {
            throw new IOException("A path inside kubejs is required");
        }
        Path supplied;
        try {
            supplied = Path.of(relativePath.replace('/', root.getFileSystem().getSeparator().charAt(0)));
        } catch (RuntimeException exception) {
            throw new IOException("Invalid path", exception);
        }
        if (supplied.isAbsolute()) {
            throw new AccessDeniedException(relativePath, null, "Absolute paths are not allowed");
        }
        Path target = root.resolve(supplied).normalize();
        if (target.equals(root) || !target.startsWith(root)) {
            throw new AccessDeniedException(relativePath, null, "The path escapes the kubejs workspace");
        }
        return target;
    }

    private void ensureExistingParent(Path target) throws IOException {
        Path parent = target.getParent();
        if (parent == null || !Files.isDirectory(parent, LinkOption.NOFOLLOW_LINKS)) {
            throw new NoSuchFileException(relative(target), null, "The parent directory does not exist");
        }
        if (Files.isSymbolicLink(parent)) {
            throw new AccessDeniedException(relative(target), null, "Symbolic links are not allowed");
        }
        verifyRealContainment(parent);
    }

    private void verifyRealContainment(Path path) throws IOException {
        Path real = path.toRealPath();
        if (!real.startsWith(root)) {
            throw new AccessDeniedException(path.toString(), null, "The path escapes the kubejs workspace");
        }
    }

    private void deleteRecursively(Path target) throws IOException {
        if (!Files.isDirectory(target, LinkOption.NOFOLLOW_LINKS)) {
            Files.delete(target);
            return;
        }
        try (Stream<Path> paths = Files.walk(target)) {
            for (Path path : paths.sorted(Comparator.reverseOrder()).toList()) {
                if (!Files.isSymbolicLink(path)) verifyRealContainment(path);
                Files.delete(path);
            }
        }
    }

    private void moveReplacing(Path source, Path target) throws IOException {
        try {
            Files.move(
                    source,
                    target,
                    StandardCopyOption.ATOMIC_MOVE,
                    StandardCopyOption.REPLACE_EXISTING);
        } catch (IOException unsupportedAtomicMove) {
            Files.move(source, target, StandardCopyOption.REPLACE_EXISTING);
        }
    }

    private String relative(Path path) {
        return root.relativize(path.toAbsolutePath().normalize())
                .toString()
                .replace('\\', '/');
    }

    private static void requireRevision(String expected, String actual)
            throws RevisionConflictException {
        if (!MessageDigest.isEqual(
                expected.getBytes(StandardCharsets.UTF_8),
                actual.getBytes(StandardCharsets.UTF_8))) {
            throw new RevisionConflictException(actual);
        }
    }

    private static String revision(byte[] bytes) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException("SHA-256 is unavailable", impossible);
        }
    }
}
