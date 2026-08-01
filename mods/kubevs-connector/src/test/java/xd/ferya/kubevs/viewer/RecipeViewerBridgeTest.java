package xd.ferya.kubevs.viewer;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

final class RecipeViewerBridgeTest {
    @AfterEach
    void clearSnapshots() {
        RecipeViewerBridge.clearAllForTests();
    }

    @Test
    void emiHasPriorityOverJei() {
        RecipeViewerBridge.publish(snapshot("jei"));
        RecipeViewerBridge.publish(snapshot("emi"));

        assertEquals(
                "emi",
                RecipeViewerBridge.preferredSnapshot().orElseThrow().provider());
        RecipeViewerBridge.clear("emi");
        assertEquals(
                "jei",
                RecipeViewerBridge.preferredSnapshot().orElseThrow().provider());
    }

    @Test
    void clearingUnknownProviderIsSafe() {
        RecipeViewerBridge.clear("emi");
        assertTrue(RecipeViewerBridge.preferredSnapshot().isEmpty());
    }

    @Test
    void displayJsonMatchesProtocolDto() {
        RecipeViewerDisplay display = snapshot("jei").displays().getFirst();
        var json = display.toJson();

        assertEquals("minecraft:test", json.get("recipeId").getAsString());
        assertEquals("minecraft:crafting", json.get("recipeType").getAsString());
        assertEquals("jei", json.get("provider").getAsString());
        assertEquals(1, json.getAsJsonArray("inputs").size());
        var input = json.getAsJsonArray("inputs").get(0).getAsJsonObject();
        assertEquals("item", input.get("kind").getAsString());
        assertEquals("minecraft:stone", input.get("id").getAsString());
        assertEquals(2, input.get("count").getAsLong());
        assertEquals(2, input.get("amount").getAsLong());
        assertEquals(0, input.get("slot").getAsInt());
        assertFalse(json.has("duration"));
    }

    @Test
    void rejectsUnsafeNegativeAmounts() {
        assertThrows(
                IllegalArgumentException.class,
                () ->
                        new RecipeViewerStack(
                                "item", "minecraft:stone", -1, 1, "Stone", 0));
    }

    @Test
    void rendersLazyLayoutThroughCommonProtocolWithoutClientClassReferences() {
        byte[] png = new byte[] {(byte) 0x89, 0x50, 0x4e, 0x47};
        RecipeViewerBridge.publishLayoutRenderer(
                "jei",
                id ->
                        java.util.concurrent.CompletableFuture.completedFuture(
                                new RecipeLayoutImage(id, "jei", 116, 54, png)));

        var result =
                RecipeViewerBridge.preferredLayoutRenderer()
                        .orElseThrow()
                        .render("minecraft:test")
                        .join()
                        .toJson();

        assertEquals("minecraft:test", result.get("recipeId").getAsString());
        assertEquals(116, result.get("width").getAsInt());
        assertTrue(result.get("dataUri").getAsString().startsWith("data:image/png;base64,"));
    }

    private static RecipeViewerSnapshot snapshot(String provider) {
        RecipeViewerStack input =
                new RecipeViewerStack(
                        "item", "minecraft:stone", 2, 1, "Stone", 0);
        RecipeViewerStack output =
                new RecipeViewerStack(
                        "item", "minecraft:stone_bricks", 4, 1, "Stone Bricks", 0);
        RecipeViewerDisplay display =
                new RecipeViewerDisplay(
                        "minecraft:test",
                        "minecraft:crafting",
                        "minecraft:crafting",
                        "Crafting",
                        provider,
                        List.of(input),
                        List.of(output),
                        List.of(),
                        List.of(),
                        null,
                        null,
                        116,
                        54,
                        null);
        return new RecipeViewerSnapshot(provider, "test", Instant.EPOCH, List.of(display));
    }
}
