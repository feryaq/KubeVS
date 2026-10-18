package xd.ferya.kubevs;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;

class ConnectorLocalizationTest {
    @Test
    void commandTranslationsHaveMatchingKeysAndArguments() throws Exception {
        JsonObject english = language("en_us");
        JsonObject russian = language("ru_ru");
        assertEquals(english.keySet(), russian.keySet());
        assertTrue(english.has("command.kubevs.join.permission"));
        assertTrue(english.has("command.kubevs.unavailable"));

        for (String key : english.keySet()) {
            if (!key.startsWith("command.kubevs.")) continue;
            String en = english.get(key).getAsString();
            String ru = russian.get(key).getAsString();
            assertTrue(!en.isBlank() && !ru.isBlank(), key);
            assertEquals(en.split("%s", -1).length, ru.split("%s", -1).length, key);
            assertEquals(ru, ConnectorTranslations.russianFallback(key), key);
        }
        assertThrows(IllegalArgumentException.class,
                () -> ConnectorTranslations.russianFallback("command.kubevs.missing"));
    }

    @Test
    void packagedMetadataPreservesRussianText() throws Exception {
        try (var stream = ConnectorLocalizationTest.class.getResourceAsStream("/META-INF/neoforge.mods.toml")) {
            assertNotNull(stream);
            String metadata = new String(stream.readAllBytes(), StandardCharsets.UTF_8);
            assertTrue(metadata.contains("KubeVS: подключение к VS Code"));
            assertTrue(metadata.contains("Связывает Minecraft с расширением KubeVS"));
            assertTrue(metadata.contains("authors = \"feryaq\""));
        }
    }

    private static JsonObject language(String locale) throws Exception {
        var stream = ConnectorLocalizationTest.class.getResourceAsStream(
                "/assets/kubevs/lang/" + locale + ".json");
        assertNotNull(stream, locale);
        try (stream; var reader = new InputStreamReader(stream, StandardCharsets.UTF_8)) {
            return JsonParser.parseReader(reader).getAsJsonObject();
        }
    }
}
