package xd.ferya.kubevs.viewer;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.mojang.serialization.JsonOps;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.RegistryOps;
import net.minecraft.server.MinecraftServer;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.crafting.Recipe;
import net.minecraft.world.item.crafting.RecipeHolder;
import net.neoforged.fml.ModList;

/**
 * JSON protocol facade for rich client snapshots with a dedicated-server RecipeManager fallback.
 */
public final class RecipeViewerProtocol {
    private static final int MAX_PAGE_SIZE = 500;
    private final MinecraftServer server;

    public RecipeViewerProtocol(MinecraftServer server) {
        this.server = server;
    }

    public JsonObject status() {
        Optional<RecipeViewerSnapshot> snapshot = RecipeViewerBridge.preferredSnapshot();
        String provider = snapshot.map(RecipeViewerSnapshot::provider).orElse("minecraft");
        JsonObject result = new JsonObject();
        result.addProperty("available", true);
        result.addProperty("provider", provider);
        snapshot.ifPresent(value -> result.addProperty("version", value.version()));
        result.addProperty("displays", true);
        result.addProperty("workstations", snapshot.isPresent());
        result.addProperty("layoutImages", RecipeViewerBridge.preferredLayoutRenderer().isPresent());
        result.addProperty("fallback", "minecraft");
        result.add("providers", providerStates());
        return result;
    }

    public JsonObject categories(JsonObject params) {
        Optional<RecipeViewerSnapshot> snapshot = RecipeViewerBridge.preferredSnapshot();
        List<JsonObject> categories = new ArrayList<>();
        if (snapshot.isPresent()) {
            snapshot.get()
                    .categories()
                    .values()
                    .forEach(
                            category -> {
                                JsonObject entry = new JsonObject();
                                entry.addProperty("id", category.id());
                                entry.addProperty("name", category.name());
                                entry.addProperty("provider", category.provider());
                                entry.addProperty("recipeCount", category.recipeCount());
                                categories.add(entry);
                            });
        } else {
            Map<String, Integer> counts = new java.util.TreeMap<>();
            for (RecipeHolder<?> holder : server.getRecipeManager().getRecipes()) {
                String type =
                        BuiltInRegistries.RECIPE_TYPE.getKey(holder.value().getType()).toString();
                counts.merge(type, 1, Integer::sum);
            }
            counts.forEach(
                    (id, count) -> {
                        JsonObject entry = new JsonObject();
                        entry.addProperty("id", id);
                        entry.addProperty("name", id);
                        entry.addProperty("provider", "minecraft");
                        entry.addProperty("recipeCount", count);
                        categories.add(entry);
                    });
        }
        return page(categories, params);
    }

    public JsonObject displays(JsonObject params) {
        String categoryId = string(params, "categoryId");
        String ingredientId = string(params, "ingredientId");
        Optional<RecipeViewerSnapshot> snapshot = RecipeViewerBridge.preferredSnapshot();
        if (snapshot.isPresent()) {
            List<JsonObject> entries =
                    snapshot.get().displays().stream()
                            .filter(
                                    display ->
                                            categoryId == null
                                                    || display.categoryId().equals(categoryId))
                            .filter(
                                    display ->
                                            ingredientId == null
                                                    || display.hasInput(ingredientId)
                                                    || display.hasOutput(ingredientId))
                            .map(RecipeViewerDisplay::toJson)
                            .toList();
            return page(entries, params);
        }

        List<RecipeHolder<?>> holders =
                server.getRecipeManager().getRecipes().stream()
                        .filter(
                                holder ->
                                        categoryId == null
                                                || recipeType(holder).equals(categoryId))
                        .sorted(Comparator.comparing(holder -> holder.id().toString()))
                        .toList();
        int offset = integer(params, "offset", 0, 0, Integer.MAX_VALUE);
        int limit = integer(params, "limit", 100, 1, MAX_PAGE_SIZE);
        int from = Math.min(offset, holders.size());
        int to = Math.min(from + limit, holders.size());
        JsonArray entries = new JsonArray();
        for (RecipeHolder<?> holder : holders.subList(from, to)) {
            RecipeViewerDisplay display = fallbackDisplay(holder);
            if (ingredientId == null
                    || display.hasInput(ingredientId)
                    || display.hasOutput(ingredientId)
                    || containsString(display.rawJson(), ingredientId)) {
                entries.add(display.toJson());
            }
        }
        JsonObject result = new JsonObject();
        result.add("entries", entries);
        result.addProperty("offset", from);
        result.addProperty("total", holders.size());
        result.addProperty("hasMore", to < holders.size());
        result.addProperty("provider", "minecraft");
        return result;
    }

    public JsonObject display(JsonObject params) {
        String recipeId = requiredString(params, "id");
        Optional<RecipeViewerDisplay> rich =
                RecipeViewerBridge.preferredSnapshot().stream()
                        .flatMap(snapshot -> snapshot.displays().stream())
                        .filter(display -> display.recipeId().equals(recipeId))
                        .findFirst();
        RecipeViewerDisplay display =
                rich.orElseGet(
                        () ->
                                server.getRecipeManager()
                                        .getRecipes()
                                        .stream()
                                        .filter(holder -> holder.id().toString().equals(recipeId))
                                        .findFirst()
                                        .map(this::fallbackDisplay)
                                        .orElseThrow(
                                                () ->
                                                        new IllegalArgumentException(
                                                                "Unknown recipe display: "
                                                                        + recipeId)));
        JsonObject result = new JsonObject();
        result.add("display", display.toJson());
        return result;
    }

    public JsonObject render(JsonObject params) {
        String recipeId = requiredString(params, "id");
        RecipeViewerBridge.LayoutRenderer renderer =
                RecipeViewerBridge.preferredLayoutRenderer()
                        .orElseThrow(
                                () ->
                                        new IllegalStateException(
                                                "Exact recipe layout rendering is unavailable. Open a Minecraft client with JEI."));
        try {
            JsonObject result = new JsonObject();
            result.add("image", renderer.render(recipeId).get(5, TimeUnit.SECONDS).toJson());
            return result;
        } catch (TimeoutException exception) {
            throw new IllegalStateException("JEI layout rendering timed out", exception);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("JEI layout rendering was interrupted", exception);
        } catch (java.util.concurrent.ExecutionException exception) {
            Throwable cause = exception.getCause();
            throw new IllegalStateException(
                    cause == null ? "JEI layout rendering failed" : cause.getMessage(), cause);
        }
    }

    public JsonObject workstations(JsonObject params) {
        String categoryId = string(params, "categoryId");
        Map<String, RecipeViewerStack> unique = new LinkedHashMap<>();
        RecipeViewerBridge.preferredSnapshot()
                .stream()
                .flatMap(snapshot -> snapshot.displays().stream())
                .filter(display -> categoryId == null || display.categoryId().equals(categoryId))
                .flatMap(display -> display.workstations().stream())
                .forEach(stack -> unique.putIfAbsent(stack.kind() + ":" + stack.id(), stack));
        return page(unique.values().stream().map(RecipeViewerStack::toJson).toList(), params);
    }

    public JsonObject usages(JsonObject params) {
        return matching(params, false);
    }

    public JsonObject recipesFor(JsonObject params) {
        return matching(params, true);
    }

    public JsonObject capabilities() {
        Optional<RecipeViewerSnapshot> snapshot = RecipeViewerBridge.preferredSnapshot();
        JsonObject capabilities = new JsonObject();
        capabilities.addProperty("recipeViewer", true);
        capabilities.addProperty(
                "recipeViewerProvider",
                snapshot.map(RecipeViewerSnapshot::provider).orElse("minecraft"));
        snapshot.ifPresent(value -> capabilities.addProperty("recipeViewerVersion", value.version()));
        capabilities.addProperty("recipeDisplays", true);
        capabilities.addProperty("recipeWorkstations", snapshot.isPresent());
        capabilities.addProperty(
                "recipeLayoutImages", RecipeViewerBridge.preferredLayoutRenderer().isPresent());
        capabilities.add("recipeViewerProviders", providerStates());
        return capabilities;
    }

    private JsonObject matching(JsonObject params, boolean outputs) {
        String ingredientId = requiredString(params, "ingredientId");
        Optional<RecipeViewerSnapshot> snapshot = RecipeViewerBridge.preferredSnapshot();
        if (snapshot.isPresent()) {
            List<JsonObject> displays =
                    snapshot.get().displays().stream()
                            .filter(
                                    display ->
                                            outputs
                                                    ? display.hasOutput(ingredientId)
                                                    : display.hasInput(ingredientId))
                            .map(RecipeViewerDisplay::toJson)
                            .toList();
            return page(displays, params);
        }
        JsonObject copied = params.deepCopy();
        copied.addProperty("ingredientId", ingredientId);
        return displays(copied);
    }

    private RecipeViewerDisplay fallbackDisplay(RecipeHolder<?> holder) {
        JsonElement encoded = encode(holder.value());
        String type = recipeType(holder);
        List<RecipeViewerStack> outputs = new ArrayList<>();
        try {
            ItemStack result = holder.value().getResultItem(server.registryAccess());
            if (!result.isEmpty()) {
                outputs.add(
                        new RecipeViewerStack(
                                "item",
                                BuiltInRegistries.ITEM.getKey(result.getItem()).toString(),
                                result.getCount(),
                                1.0,
                                result.getHoverName().getString(),
                                0));
            }
        } catch (RuntimeException ignored) {
            // Some dynamic recipes intentionally cannot compute an output without an input.
        }
        return new RecipeViewerDisplay(
                holder.id().toString(),
                type,
                type,
                type,
                "minecraft",
                List.of(),
                outputs,
                List.of(),
                List.of(),
                null,
                null,
                null,
                null,
                encoded);
    }

    private JsonElement encode(Recipe<?> recipe) {
        RegistryOps<JsonElement> ops =
                RegistryOps.create(JsonOps.INSTANCE, server.registryAccess());
        return Recipe.CODEC
                .encodeStart(ops, recipe)
                .getOrThrow(
                        message ->
                                new IllegalStateException(
                                        "Recipe encoding failed: " + message));
    }

    private static String recipeType(RecipeHolder<?> holder) {
        return BuiltInRegistries.RECIPE_TYPE.getKey(holder.value().getType()).toString();
    }

    private JsonArray providerStates() {
        JsonArray providers = new JsonArray();
        for (String id : List.of("emi", "jei")) {
            Optional<RecipeViewerSnapshot> snapshot = RecipeViewerBridge.snapshot(id);
            JsonObject provider = new JsonObject();
            provider.addProperty("id", id);
            provider.addProperty("installed", ModList.get().isLoaded(id));
            provider.addProperty("available", snapshot.isPresent());
            String version =
                    ModList.get()
                            .getModContainerById(id)
                            .map(container -> container.getModInfo().getVersion().toString())
                            .orElse(null);
            if (version != null) {
                provider.addProperty("version", version);
            }
            provider.addProperty("richDisplays", snapshot.isPresent());
            provider.addProperty(
                    "layoutImages", RecipeViewerBridge.layoutRenderer(id).isPresent());
            providers.add(provider);
        }
        return providers;
    }

    private static JsonObject page(List<JsonObject> all, JsonObject params) {
        int offset = integer(params, "offset", 0, 0, Integer.MAX_VALUE);
        int limit = integer(params, "limit", 100, 1, MAX_PAGE_SIZE);
        int from = Math.min(offset, all.size());
        int to = Math.min(from + limit, all.size());
        JsonArray entries = new JsonArray();
        all.subList(from, to).forEach(entries::add);
        JsonObject result = new JsonObject();
        result.add("entries", entries);
        result.addProperty("offset", from);
        result.addProperty("total", all.size());
        result.addProperty("hasMore", to < all.size());
        return result;
    }

    private static boolean containsString(JsonElement element, String value) {
        if (element == null || element.isJsonNull()) {
            return false;
        }
        if (element.isJsonPrimitive()) {
            return element.getAsJsonPrimitive().isString()
                    && element.getAsString().equals(value);
        }
        if (element.isJsonArray()) {
            for (JsonElement child : element.getAsJsonArray()) {
                if (containsString(child, value)) {
                    return true;
                }
            }
            return false;
        }
        for (Map.Entry<String, JsonElement> child : element.getAsJsonObject().entrySet()) {
            if (containsString(child.getValue(), value)) {
                return true;
            }
        }
        return false;
    }

    private static String string(JsonObject object, String key) {
        return object.has(key) && object.get(key).isJsonPrimitive()
                ? object.get(key).getAsString()
                : null;
    }

    private static String requiredString(JsonObject object, String key) {
        String value = string(object, key);
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("Missing parameter: " + key);
        }
        return value;
    }

    private static int integer(
            JsonObject object, String key, int fallback, int minimum, int maximum) {
        if (!object.has(key) || !object.get(key).isJsonPrimitive()) {
            return fallback;
        }
        int value = object.get(key).getAsInt();
        return Math.max(minimum, Math.min(maximum, value));
    }
}
