package xd.ferya.kubevs;

final class RateLimiter {
    private final int limit;
    private final long windowMillis;
    private int used;
    private long windowStarted;

    RateLimiter(int limit, long windowMillis, long nowMillis) {
        if (limit <= 0 || windowMillis <= 0) {
            throw new IllegalArgumentException("Rate limit values must be positive");
        }
        this.limit = limit;
        this.windowMillis = windowMillis;
        this.windowStarted = nowMillis;
    }

    synchronized boolean tryAcquire(long nowMillis) {
        if (nowMillis - windowStarted >= windowMillis) {
            used = 0;
            windowStarted = nowMillis;
        }
        if (used >= limit) {
            return false;
        }
        used++;
        return true;
    }
}
