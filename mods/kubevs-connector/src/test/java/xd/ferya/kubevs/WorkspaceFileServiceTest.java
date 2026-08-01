package xd.ferya.kubevs;

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

        WorkspaceFileService.FileContent created =
                service.write("server_scripts/main.js", "first", "");
        assertEquals("first", service.read("server_scripts/main.js").content());

        WorkspaceFileService.RevisionConflictException conflict = assertThrows(
                WorkspaceFileService.RevisionConflictException.class,
                () -> service.write("server_scripts/main.js", "lost update", ""));
        assertEquals(created.revision(), conflict.actualRevision());

        WorkspaceFileService.FileContent updated =
                service.write("server_scripts/main.js", "second", created.revision());
        assertEquals("second", service.read("server_scripts/main.js").content());
        assertEquals(updated.revision(), service.list().getFirst().revision());
    }

    @Test
    void rejectsTraversalAbsolutePathsAndOversizedContent() throws Exception {
        WorkspaceFileService service =
                new WorkspaceFileService(temporaryDirectory.resolve("kubejs"), 8, 20);

        assertThrows(IOException.class, () -> service.write("../outside.js", "x", ""));
        assertThrows(
                IOException.class,
                () -> service.write(temporaryDirectory.resolve("outside.js").toString(), "x", ""));
        assertThrows(IOException.class, () -> service.write("server_scripts/a.js", "123456789", ""));
        assertTrue(Files.notExists(temporaryDirectory.resolve("outside.js")));
    }

    @Test
    void doesNotReadOrWriteThroughSymbolicLinks() throws Exception {
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
    }
}
