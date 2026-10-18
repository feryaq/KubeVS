package xd.ferya.kubevs;

import com.google.gson.JsonParser;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

/** Russian chat fallbacks for clients without the mod language resources. */
final class ConnectorTranslations {
    private static final Map<String, String> RUSSIAN = loadRussian();

    private ConnectorTranslations() {}

    static String russianFallback(String fullKey) {
        String fallback = RUSSIAN.get(fullKey);
        if (fallback == null) {
            throw new IllegalArgumentException("Нет русского перевода KubeVS: " + fullKey);
        }
        return fallback;
    }

    private static Map<String, String> loadRussian() {
        try (var stream = ConnectorTranslations.class.getResourceAsStream(
                        "/assets/kubevs/lang/ru_ru.json")) {
            if (stream == null) {
                throw new IllegalStateException("Не найден файл русского перевода KubeVS");
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
            throw new IllegalStateException("Не удалось прочитать русский перевод KubeVS", exception);
        }
    }
}
