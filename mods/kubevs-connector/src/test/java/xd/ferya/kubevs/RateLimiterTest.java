package xd.ferya.kubevs;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class RateLimiterTest {
    @Test
    void resetsAfterWindowAndRejectsBurst() {
        RateLimiter limiter = new RateLimiter(2, 1000, 0);
        assertTrue(limiter.tryAcquire(0));
        assertTrue(limiter.tryAcquire(10));
        assertFalse(limiter.tryAcquire(20));
        assertTrue(limiter.tryAcquire(1000));
    }
}
