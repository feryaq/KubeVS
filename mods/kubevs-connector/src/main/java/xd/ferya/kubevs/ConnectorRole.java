package xd.ferya.kubevs;

import java.util.Arrays;
import java.util.List;
import java.util.Locale;

enum ConnectorRole {
    VIEWER(
            "viewer",
            "Viewer",
            1,
            List.of(
                    ConnectorPermissions.CONNECT,
                    ConnectorPermissions.REGISTRY_READ,
                    ConnectorPermissions.RECIPES_READ,
                    ConnectorPermissions.WORKSPACE_READ)),
    EDITOR(
            "editor",
            "Editor",
            2,
            List.of(
                    ConnectorPermissions.CONNECT,
                    ConnectorPermissions.REGISTRY_READ,
                    ConnectorPermissions.RECIPES_READ,
                    ConnectorPermissions.WORKSPACE_READ,
                    ConnectorPermissions.WORKSPACE_WRITE,
                    ConnectorPermissions.WORKSPACE_MANAGE)),
    OPERATOR(
            "operator",
            "Operator",
            3,
            List.of(
                    ConnectorPermissions.CONNECT,
                    ConnectorPermissions.REGISTRY_READ,
                    ConnectorPermissions.RECIPES_READ,
                    ConnectorPermissions.LOGS_READ,
                    ConnectorPermissions.RELOAD_SERVER,
                    ConnectorPermissions.WORKSPACE_READ,
                    ConnectorPermissions.WORKSPACE_WRITE,
                    ConnectorPermissions.WORKSPACE_MANAGE)),
    ADMIN(
            "admin",
            "Administrator",
            4,
            List.of(
                    ConnectorPermissions.CONNECT,
                    ConnectorPermissions.REGISTRY_READ,
                    ConnectorPermissions.RECIPES_READ,
                    ConnectorPermissions.LOGS_READ,
                    ConnectorPermissions.RELOAD_SERVER,
                    ConnectorPermissions.INSPECT,
                    ConnectorPermissions.WORKSPACE_READ,
                    ConnectorPermissions.WORKSPACE_WRITE,
                    ConnectorPermissions.WORKSPACE_MANAGE,
                    ConnectorPermissions.ACCOUNTS_MANAGE));

    private final String id;
    private final String displayName;
    private final int legacyLevel;
    private final List<String> permissions;

    ConnectorRole(String id, String displayName, int legacyLevel, List<String> permissions) {
        this.id = id;
        this.displayName = displayName;
        this.legacyLevel = legacyLevel;
        this.permissions = List.copyOf(permissions);
    }

    String id() {
        return id;
    }

    String displayName() {
        return displayName;
    }

    int legacyLevel() {
        return legacyLevel;
    }

    List<String> permissions() {
        return permissions;
    }

    static ConnectorRole parse(String value) {
        if (value == null) {
            throw new IllegalArgumentException("Role is required");
        }
        String normalized = value.trim().toLowerCase(Locale.ROOT);
        return Arrays.stream(values())
                .filter(role -> role.id.equals(normalized))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException(
                        "Unknown role: " + value + ". Available roles: viewer, editor, operator, admin"));
    }

    static ConnectorRole fromLegacyLevel(int level) {
        if (level >= 4) return ADMIN;
        if (level >= 3) return OPERATOR;
        if (level >= 2) return EDITOR;
        return VIEWER;
    }
}
