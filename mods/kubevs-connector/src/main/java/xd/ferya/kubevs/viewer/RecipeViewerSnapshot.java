package xd.ferya.kubevs.viewer;

import java.time.Instant;
import java.util.Comparator;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.TreeMap;
import java.util.function.Predicate;

/** Thread-safe-by-immutability snapshot published by an optional client adapter. */
public record RecipeViewerSnapshot(
        String provider,
        String version,
        Instant createdAt,
        List<RecipeViewerDisplay> displays) {
    public RecipeViewerSnapshot {
        provider = Objects.requireNonNull(provider, "provider");
        version = Objects.requireNonNullElse(version, "unknown");
        createdAt = Objects.requireNonNull(createdAt, "createdAt");
        displays =
                displays.stream()
                        .sorted(Comparator.comparing(RecipeViewerDisplay::recipeId))
                        .toList();
    }

    public List<RecipeViewerDisplay> matching(Predicate<RecipeViewerDisplay> predicate) {
        return displays.stream().filter(predicate).toList();
    }

    public Map<String, Category> categories() {
        Map<String, Category> categories = new TreeMap<>();
        for (RecipeViewerDisplay display : displays) {
            categories.compute(
                    display.categoryId(),
                    (ignored, current) ->
                            current == null
                                    ? new Category(
                                            display.categoryId(),
                                            display.categoryName(),
                                            provider,
                                            1)
                                    : new Category(
                                            current.id(),
                                            current.name(),
                                            current.provider(),
                                            current.recipeCount() + 1));
        }
        return Collections.unmodifiableMap(categories);
    }

    public record Category(String id, String name, String provider, int recipeCount) {}
}
