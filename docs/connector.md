# KubeVS Connector

Status: **Experimental / Requires Connector**

The NeoForge 1.21.1 mod starts its WebSocket listener during `ServerStartingEvent` and stops it
during `ServerStoppingEvent`. It contains no client-only imports.

## Connection

1. Start Minecraft or the dedicated server with KubeVS Connector.
2. Open the Minecraft instance or its `kubejs` directory in VS Code.
3. Run **KubeVS: Connect to Minecraft**.

In a trusted workspace, KubeVS finds `config/kubevs-connector-token.txt` automatically. When more
than one instance is available, select it from the native Quick Pick. For a remote server, choose a
token file or paste the token. Successful credentials are stored in VS Code SecretStorage per
`host:port`.

Run **KubeVS: Change Connector Token** after rotating a token. A rejected saved token is removed
automatically and the selector opens again.

Server administrators can manage authentication without editing files or restarting Minecraft:

- `/kubevs auth` shows the endpoint, connected-client count, and in-game action buttons;
- **Copy token** puts the token on the administrator's clipboard without printing it into logs;
- **Rotate** generates and activates a replacement token after explicit confirmation, then
  disconnects existing clients so they must authenticate again.

These commands require permission level 4. The dedicated-server console shows only the token file
path; it never prints the secret itself.

Defaults:

```text
host: 127.0.0.1
port: 32145
reload: disabled
remote binding: disabled
```

NeoForge creates `config/kubevs-connector.toml` on first start. Network and permission settings are
configured there; JVM `-Dkubevs.*` flags are not required. Restart Minecraft or the dedicated
server after changing the file.

## Save and Reload

The command saves all files, runs available static validation, warns about `startup_scripts`, checks
live capabilities, requests reload, fetches the latest Connector logs, and only then reports
success. `startup_scripts` are never reported as applied by a normal server reload.
