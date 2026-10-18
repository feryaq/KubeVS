package xd.ferya.kubevs;

import static org.junit.jupiter.api.Assertions.*;
import java.util.List;
import org.junit.jupiter.api.Test;

final class RecipeSnapshotVersionTest {
    @Test
    void detectsReloadEvenWhenCountAndIdsHaveNotChanged() {
        RecipeSnapshotVersion<String> tracker = new RecipeSnapshotVersion<>();
        String first = new String("pack:recipe");
        String revision = tracker.check(List.of(first), null);
        assertEquals(revision, tracker.check(List.of(first), revision));
        String reloaded = new String("pack:recipe");
        assertThrows(IllegalArgumentException.class, () -> tracker.check(List.of(reloaded), revision));
        assertNotEquals(revision, tracker.check(List.of(reloaded), null));
    }

    @Test
    void detectsDeletedRecipesAndKeepsEmptySnapshotStable() {
        RecipeSnapshotVersion<Object> tracker = new RecipeSnapshotVersion<>();
        Object recipe = new Object();
        String revision = tracker.check(List.of(recipe), null);
        assertThrows(IllegalArgumentException.class, () -> tracker.check(List.of(), revision));
        String empty = tracker.check(List.of(), null);
        assertEquals(empty, tracker.check(List.of(), empty));
    }
}
