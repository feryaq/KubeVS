package xd.ferya.kubevs;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

final class WorkspaceLockManager {
    record Owner(String sessionId, String displayName) {
        Owner {
            if (sessionId == null || sessionId.isBlank()) {
                throw new IllegalArgumentException("Session id is required");
            }
            if (displayName == null || displayName.isBlank()) {
                throw new IllegalArgumentException("Display name is required");
            }
        }
    }

    record Lock(String path, Owner owner) {}

    private final Map<String, Lock> locks = new LinkedHashMap<>();

    synchronized Lock acquire(String path, Owner owner) {
        Lock existing = locks.get(path);
        if (existing != null && !existing.owner().sessionId().equals(owner.sessionId())) {
            return existing;
        }
        Lock lock = new Lock(path, owner);
        locks.put(path, lock);
        return lock;
    }

    synchronized boolean isOwnedBy(String path, Owner owner) {
        Lock lock = locks.get(path);
        return lock != null && lock.owner().sessionId().equals(owner.sessionId());
    }

    synchronized Lock status(String path) {
        return locks.get(path);
    }

    synchronized Lock conflict(String path, Owner owner) {
        return locks.values().stream()
                .filter(lock -> !lock.owner().sessionId().equals(owner.sessionId()))
                .filter(lock -> lock.path().equals(path)
                        || lock.path().startsWith(path + "/")
                        || path.startsWith(lock.path() + "/"))
                .findFirst()
                .orElse(null);
    }

    synchronized boolean release(String path, Owner owner) {
        if (!isOwnedBy(path, owner)) {
            return false;
        }
        locks.remove(path);
        return true;
    }

    synchronized int releaseTree(String path) {
        int before = locks.size();
        locks.entrySet().removeIf(entry ->
                entry.getKey().equals(path) || entry.getKey().startsWith(path + "/"));
        return before - locks.size();
    }

    synchronized int releaseAll(Owner owner) {
        int before = locks.size();
        locks.entrySet().removeIf(
                entry -> entry.getValue().owner().sessionId().equals(owner.sessionId()));
        return before - locks.size();
    }

    synchronized List<Lock> list() {
        List<Lock> result = new ArrayList<>(locks.values());
        result.sort(Comparator.comparing(Lock::path));
        return List.copyOf(result);
    }
}
