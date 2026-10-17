package xd.ferya.kubevs;

import com.google.gson.JsonParser;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

/** English chat fallbacks for players who have not installed the optional client mod. */
final class ConnectorTranslations {
    private static final Map<String, String> ENGLISH = loadEnglish();

    private ConnectorTranslations() {}

    static String englishFallback(String fullKey) {
        String fallback = ENGLISH.get(fullKey);
        if (fallback == null) {
            throw new IllegalArgumentException("Missing KubeVS English translation: " + fullKey);
        }
        return fallback;
    }

    private static Map<String, String> loadEnglish() {
        try (var stream = ConnectorTranslations.class.getResourceAsStream(
                        "/assets/kubevs/lang/en_us.json")) {
            if (stream == null) {
                throw new IllegalStateException("KubeVS English language resource is missing");
            }
            try (var reader = new InputStreamReader(stream, StandardCharsets.UTF_8)) {
                var json = JsonParser.parseReader(reader).getAsJsonObject();
                Map<String, String> translations = new HashMap<>();
                for (var entry : json.entrySet()) {
                    if (entry.getKey().startsWith("command.kubevs.")) {
                        translations.put(entry.getKey(), entry.getValue().getAsString());
                    }
                }
                return Map.copyOf(translations);
            }
        } catch (IOException exception) {
            throw new IllegalStateException("Could not read KubeVS English translations", exception);
        }
    }
}
