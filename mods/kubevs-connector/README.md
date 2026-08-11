# KubeVS Connector 1.1.5

KubeVS Connector is the secure NeoForge bridge between a Minecraft 1.21.1 server and the KubeVS Visual Studio Code extension.

It exposes live registries, recipes, tags, mods, and logs, then mounts the server's `kubejs` directory in VS Code with player roles, team locks, revision protection, and binary-safe file operations. The connected player's Minecraft language is sent to KubeVS so each editor session uses the matching English or Russian UI.

## Installation

1. Place the production JAR in the server's `mods` directory.
2. Start and stop the server once to create `config/kubevs-connector.toml`.
3. Review the network and permission settings.
4. Start the server and run `/kvs join` in game.
5. In VS Code, run **KubeVS: Connect with /kvs join code**.

KubeJS is optional for registry inspection but required for creating and applying KubeJS scripts.

## Default configuration

```toml
[network]
host = "127.0.0.1"
port = 32145
allowRemote = false
publicHost = ""
publicPort = 0
publicSecure = false

[permissions]
joinPermissionLevel = 2
defaultRole = "EDITOR"
allowReload = false
```

For a dedicated server, use a VPN or a TLS reverse proxy. `publicHost`, `publicPort`, and `publicSecure` define the address placed in connection codes; they do not add TLS to the Java server itself.

## Commands

```text
/kvs join
/kvs users
/kvs role <player> <viewer|editor|operator|admin>
/kvs revoke <player>
/kvs auth
/kvs auth rotate
```

Build with Java 21:

```powershell
.\gradlew.bat :mods:kubevs-connector:test :mods:kubevs-connector:build --no-daemon
```
