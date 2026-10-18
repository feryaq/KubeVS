package xd.ferya.kubevs;

import java.util.function.Consumer;

/** A saved policy becomes effective only after persistence succeeds. */
final class ReloadPolicy {
    private volatile boolean enabled;

    ReloadPolicy(boolean initial) {
        enabled = initial;
    }

    boolean enabled() {
        return enabled;
    }

    synchronized void update(ConnectorRole role, boolean value, Consumer<Boolean> persist) {
        if (role != ConnectorRole.ADMIN) {
            throw new IllegalArgumentException("Только администратор может разрешать перезагрузку ресурсов");
        }
        persist.accept(value);
        enabled = value;
    }
}
