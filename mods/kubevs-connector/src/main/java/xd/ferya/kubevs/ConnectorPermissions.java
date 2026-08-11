package xd.ferya.kubevs;

import java.util.List;

final class ConnectorPermissions {
    static final String CONNECT = "kubevs.connect";
    static final String REGISTRY_READ = "kubevs.registry.read";
    static final String RECIPES_READ = "kubevs.recipes.read";
    static final String LOGS_READ = "kubevs.logs.read";
    static final String RELOAD_SERVER = "kubevs.reload";
    static final String INSPECT = "kubevs.inspect";
    static final String WORKSPACE_READ = "kubevs.workspace.read";
    static final String WORKSPACE_WRITE = "kubevs.workspace.write";
    static final String WORKSPACE_MANAGE = "kubevs.workspace.manage";
    static final String ACCOUNTS_MANAGE = "kubevs.accounts.manage";

    private ConnectorPermissions() {}

    static boolean allows(ConnectorRole role, String permission) {
        return role.permissions().contains(permission);
    }

    static List<String> forRole(ConnectorRole role) {
        return role.permissions();
    }
}
