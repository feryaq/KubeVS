package xd.ferya.kubevs.viewer;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import java.util.List;
import java.util.Objects;

/** Immutable rich recipe display captured from a client recipe viewer. */
public record RecipeViewerDisplay(
        String recipeId,
        String recipeType,
        String categoryId,
        String categoryName,
        String provider,
        List<RecipeViewerStack> inputs,
        List<RecipeViewerStack> outputs,
        List<RecipeViewerStack> catalysts,
        List<RecipeViewerStack> workstations,
        Long duration,
        Long energy,
        Integer width,
        Integer height,
        JsonElement rawJson) {
    public RecipeViewerDisplay {
        recipeId = requireText(recipeId, "recipeId");
        recipeType = requireText(recipeType, "recipeType");
        categoryId = requireText(categoryId, "categoryId");
        categoryName = Objects.requireNonNullElse(categoryName, categoryId);
        provider = requireText(provider, "provider");
        inputs = List.copyOf(inputs);
        outputs = List.copyOf(outputs);
        catalysts = List.copyOf(catalysts);
        workstations = List.copyOf(workstations);
        rawJson = rawJson == null ? null : rawJson.deepCopy();
    }

    public JsonObject toJson() {
        JsonObject json = new JsonObject();
        json.addProperty("recipeId", recipeId);
        json.addProperty("recipeType", recipeType);
        json.addProperty("categoryId", categoryId);
        json.addProperty("categoryName", categoryName);
        json.addProperty("provider", provider);
        json.add("inputs", stacks(inputs));
        json.add("outputs", stacks(outputs));
        json.add("catalysts", stacks(catalysts));
        json.add("workstations", stacks(workstations));
        if (duration != null) {
            json.addProperty("duration", duration);
        }
        if (energy != null) {
            json.addProperty("energy", energy);
        }
        if (width != null) {
            json.addProperty("width", width);
        }
        if (height != null) {
            json.addProperty("height", height);
        }
        if (rawJson != null) {
            json.add("rawJson", rawJson.deepCopy());
        }
        return json;
    }

    public boolean hasInput(String ingredientId) {
        return contains(inputs, ingredientId) || contains(catalysts, ingredientId);
    }

    public boolean hasOutput(String ingredientId) {
        return contains(outputs, ingredientId);
    }

    private static boolean contains(List<RecipeViewerStack> stacks, String ingredientId) {
        return stacks.stream().anyMatch(stack -> stack.id().equals(ingredientId));
    }

    private static JsonArray stacks(List<RecipeViewerStack> stacks) {
        JsonArray result = new JsonArray();
        stacks.forEach(stack -> result.add(stack.toJson()));
        return result;
    }

    private static String requireText(String value, String field) {
        String checked = Objects.requireNonNull(value, field);
        if (checked.isBlank()) {
            throw new IllegalArgumentException(field + " must not be blank");
        }
        return checked;
    }
}
