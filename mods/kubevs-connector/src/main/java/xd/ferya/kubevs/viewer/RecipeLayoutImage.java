package xd.ferya.kubevs.viewer;

import com.google.gson.JsonObject;
import java.util.Base64;

/** A lazily rendered recipe-viewer layout. The common protocol stays client-class-free. */
public record RecipeLayoutImage(
        String recipeId, String provider, int width, int height, byte[] png) {
    public RecipeLayoutImage {
        png = png.clone();
    }

    @Override
    public byte[] png() {
        return png.clone();
    }

    public JsonObject toJson() {
        JsonObject json = new JsonObject();
        json.addProperty("recipeId", recipeId);
        json.addProperty("provider", provider);
        json.addProperty("width", width);
        json.addProperty("height", height);
        json.addProperty(
                "dataUri", "data:image/png;base64," + Base64.getEncoder().encodeToString(png));
        return json;
    }
}
