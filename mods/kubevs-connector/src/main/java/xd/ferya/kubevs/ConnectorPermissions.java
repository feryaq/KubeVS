package xd.ferya.kubevs;

final class ConnectorPermissions {
    static final int READ_WORKSPACE = 1;
    static final int EDIT_WORKSPACE = 2;
    static final int READ_LOGS = 2;
    static final int RELOAD_SERVER = 2;

    private ConnectorPermissions() {}

    static boolean allows(int actualLevel, int requiredLevel) {
        return actualLevel >= requiredLevel;
    }
}
