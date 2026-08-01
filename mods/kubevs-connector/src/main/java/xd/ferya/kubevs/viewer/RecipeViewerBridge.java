package xd.ferya.kubevs.viewer;

import java.util.Map;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Common/server-safe hand-off between optional client recipe-viewer plugins and the Connector.
 *
 * <p>This class deliberately has no JEI, EMI or {@code net.minecraft.client} references.
 */
public final class RecipeViewerBridge {
    private static final Map<String, RecipeViewerSnapshot> SNAPSHOTS = new ConcurrentHashMap<>();
    private static final Map<String, LayoutRenderer> LAYOUT_RENDERERS = new ConcurrentHashMap<>();

    private RecipeViewerBridge() {}

    public static void publish(RecipeViewerSnapshot snapshot) {
        SNAPSHOTS.put(snapshot.provider(), snapshot);
    }

    public static void clear(String provider) {
        SNAPSHOTS.remove(provider);
        LAYOUT_RENDERERS.remove(provider);
    }

    public static void publishLayoutRenderer(String provider, LayoutRenderer renderer) {
        LAYOUT_RENDERERS.put(provider, renderer);
    }

    public static Optional<LayoutRenderer> layoutRenderer(String provider) {
        return Optional.ofNullable(LAYOUT_RENDERERS.get(provider));
    }

    /** Exact JEI layouts are preferred because EMI currently exposes only structured data here. */
    public static Optional<LayoutRenderer> preferredLayoutRenderer() {
        LayoutRenderer jei = LAYOUT_RENDERERS.get("jei");
        return jei == null ? LAYOUT_RENDERERS.values().stream().findFirst() : Optional.of(jei);
    }

    public static Optional<RecipeViewerSnapshot> snapshot(String provider) {
        return Optional.ofNullable(SNAPSHOTS.get(provider));
    }

    /** EMI is preferred because its public API exposes recipe-tree semantics directly. */
    public static Optional<RecipeViewerSnapshot> preferredSnapshot() {
        RecipeViewerSnapshot emi = SNAPSHOTS.get("emi");
        return emi == null ? Optional.ofNullable(SNAPSHOTS.get("jei")) : Optional.of(emi);
    }

    static void clearAllForTests() {
        SNAPSHOTS.clear();
        LAYOUT_RENDERERS.clear();
    }

    @FunctionalInterface
    public interface LayoutRenderer {
        CompletableFuture<RecipeLayoutImage> render(String recipeId);
    }
}
