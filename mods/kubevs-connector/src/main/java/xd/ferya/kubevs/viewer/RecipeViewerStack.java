package xd.ferya.kubevs.viewer;

import com.google.gson.JsonObject;
import java.util.Objects;

/**
 * Loader-neutral ingredient used by the KubeVS protocol.
 *
 * <p>{@code slot} groups alternatives that occupy the same JEI/EMI recipe slot.
 */
public record RecipeViewerStack(
        String kind,
        String id,
        long amount,
        double chance,
        String name,
        int slot) {
    public RecipeViewerStack {
        kind = requireText(kind, "kind");
        id = requireText(id, "id");
        if (amount < 0) {
            throw new IllegalArgumentException("amount must not be negative");
        }
        if (!Double.isFinite(chance) || chance < 0) {
            throw new IllegalArgumentException("chance must be finite and non-negative");
        }
        if (slot < 0) {
            throw new IllegalArgumentException("slot must not be negative");
        }
    }

    public JsonObject toJson() {
        JsonObject json = new JsonObject();
        json.addProperty("kind", kind);
        json.addProperty("id", id);
        json.addProperty("count", amount);
        json.addProperty("amount", amount);
        json.addProperty("chance", chance);
        if (name != null && !name.isBlank()) {
            json.addProperty("name", name);
        }
        json.addProperty("slot", slot);
        return json;
    }

    private static String requireText(String value, String field) {
        String checked = Objects.requireNonNull(value, field);
        if (checked.isBlank()) {
            throw new IllegalArgumentException(field + " must not be blank");
        }
        return checked;
    }
}
