package xd.ferya.kubevs;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

final class WorkspaceFileServiceTest {
    @TempDir
    Path temporaryDirectory;

    @Test
    void writesAtomicallyAndRequiresTheCurrentRevision() throws Exception {
        WorkspaceFileService service =
                new WorkspaceFileService(temporaryDirectory.resolve("kubejs"), 128, 20);
        service.createDirectory("server_scripts");

        WorkspaceFileService.FileEntry created =
                service.write("server_scripts/main.js", "first", "");
        assertEquals("first", text(service.read("server_scripts/main.js")));

        WorkspaceFileService.RevisionConflictException conflict = assertThrows(
                WorkspaceFileService.RevisionConflictException.class,
                () -> service.write("server_scripts/main.js", "lost update", ""));
        assertEquals(created.revision(), conflict.actualRevision());

        WorkspaceFileService.FileEntry updated =
                service.write("server_scripts/main.js", "second", created.revision());
        assertEquals("second", text(service.read("server_scripts/main.js")));
        assertEquals(
                updated.revision(),
                service.list().stream()
                        .filter(entry -> entry.path().equals("server_scripts/main.js"))
                        .findFirst()
                        .orElseThrow()
                        .revision());
    }

    @Test
    void supportsDirectoryCreateCopyRenameAndRecursiveDelete() throws Exception {
        WorkspaceFileService service =
                new WorkspaceFileService(temporaryDirectory.resolve("kubejs"), 128, 50);
        service.createDirectory("server_scripts");
        service.createDirectory("server_scripts/team");
        service.write("server_scripts/team/main.js", "hello", "");

        service.copy("server_scripts/team", "server_scripts/copy", false);
        assertEquals("hello", text(service.read("server_scripts/copy/main.js")));

        service.write("server_scripts/target.js", "old", "");
        service.copy("server_scripts/team/main.js", "server_scripts/target.js", true);
        assertEquals("hello", text(service.read("server_scripts/target.js")));

        service.rename("server_scripts/copy", "server_scripts/renamed", false, "");
        assertEquals("hello", text(service.read("server_scripts/renamed/main.js")));

        service.delete("server_scripts/renamed", true, "");
        assertThrows(IOException.class, () -> service.stat("server_scripts/renamed"));
    }

    @Test
    void preservesBinaryAssetsWithoutUtf8Conversion() throws Exception {
        WorkspaceFileService service =
                new WorkspaceFileService(temporaryDirectory.resolve("kubejs"), 128, 20);
        service.createDirectory("assets");
        byte[] image = new byte[] {0, 1, 2, (byte) 0xff, 10};

        service.write("assets/icon.png", image, "");

        assertArrayEquals(image, service.read("assets/icon.png").bytes());
    }

    @Test
    void rejectsTraversalAbsolutePathsMissingParentsAndOversizedContent() throws Exception {
        WorkspaceFileService service =
                new WorkspaceFileService(temporaryDirectory.resolve("kubejs"), 8, 20);

        assertThrows(IOException.class, () -> service.write("../outside.js", "x", ""));
        assertThrows(
                IOException.class,
                () -> service.write(temporaryDirectory.resolve("outside.js").toString(), "x", ""));
        assertThrows(IOException.class, () -> service.write("missing/a.js", "x", ""));
        service.createDirectory("server_scripts");
        assertThrows(IOException.class, () -> service.write("server_scripts/a.js", "123456789", ""));
        assertTrue(Files.notExists(temporaryDirectory.resolve("outside.js")));
    }

    @Test
    void doesNotReadWriteOrCopyThroughSymbolicLinks() throws Exception {
        Path workspace = temporaryDirectory.resolve("kubejs");
        Path outside = temporaryDirectory.resolve("outside");
        Files.createDirectories(workspace);
        Files.createDirectories(outside);
        Files.writeString(outside.resolve("secret.js"), "secret", StandardCharsets.UTF_8);
        Path link = workspace.resolve("linked");
        try {
            Files.createSymbolicLink(link, outside);
        } catch (UnsupportedOperationException | IOException exception) {
            return;
        }

        WorkspaceFileService service = new WorkspaceFileService(workspace, 128, 20);
        assertThrows(IOException.class, () -> service.read("linked/secret.js"));
        assertThrows(IOException.class, () -> service.write("linked/new.js", "x", ""));
        assertThrows(IOException.class, () -> service.copy("linked", "copied", false));
    }
    private static String text(WorkspaceFileService.FileContent file) {
        return new String(file.bytes(), StandardCharsets.UTF_8);
    }
}
