package xd.ferya.kubevs;

import static org.junit.jupiter.api.Assertions.*;
import com.google.gson.JsonParser;
import org.junit.jupiter.api.Test;

class RequestEnvelopeTest {
    @Test
    void validatesTypesAndRetainsCorrelationForInvalidParams() {
        var valid = JsonParser.parseString("{\"type\":\"request\",\"requestId\":\"42\",\"method\":\"connector.status\"}").getAsJsonObject();
        assertTrue(RequestEnvelope.isValid(valid));
        valid.addProperty("params", "invalid");
        assertFalse(RequestEnvelope.isValid(valid));
        assertEquals("42", RequestEnvelope.requestId(valid));
        valid.addProperty("requestId", 42);
        assertNull(RequestEnvelope.requestId(valid));
        valid.addProperty("requestId", " ");
        assertFalse(RequestEnvelope.isValid(valid));
    }
}
