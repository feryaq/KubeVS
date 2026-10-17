package xd.ferya.kubevs;

import com.google.gson.JsonObject;

/** Transport validation before scheduling work on the Minecraft server thread. */
final class RequestEnvelope {
    private RequestEnvelope() {}

    static boolean isValid(JsonObject request) {
        return "request".equals(text(request, "type"))
                && requestId(request) != null
                && text(request, "method") != null
                && !text(request, "method").isBlank()
                && text(request, "method").length() <= 128
                && (!request.has("params") || request.get("params").isJsonObject());
    }

    static String requestId(JsonObject request) {
        String id = text(request, "requestId");
        return id != null && !id.isBlank() && id.length() <= 128 ? id : null;
    }

    private static String text(JsonObject request, String key) {
        return request.has(key) && request.get(key).isJsonPrimitive()
                        && request.getAsJsonPrimitive(key).isString()
                ? request.get(key).getAsString() : null;
    }
}
