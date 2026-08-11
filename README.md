# KubeVS

**A professional KubeJS development environment inside Visual Studio Code.**

KubeVS combines a Visual Studio Code extension with a secure NeoForge server bridge. Build recipes visually, browse the live Minecraft registry, understand production chains, and edit the server's KubeJS workspace without leaving your editor.

**KubeVS is free to download and use. There are no subscriptions, paid features, license keys, or usage fees.**

## Release matrix

| Component          | Version | Platform                                 |
| ------------------ | ------: | ---------------------------------------- |
| KubeVS Extension   |  1.1.11 | Visual Studio Code 1.105+                |
| KubeVS Connector   |  1.1.11 | Minecraft 1.21.1, NeoForge 21.x, Java 21 |
| WebSocket protocol |       2 | Localhost-only by default                |

## What KubeVS gives you

- A focused Dashboard and dedicated Project, Recipes, LootJS, Registries, and Connection views.
- KubeJS completion, hover information, diagnostics, Code Actions, project indexing, and live typings.
- Visual editors for Vanilla, Create, Oritech, Farmer's Delight, Sequenced Assembly, and custom-schema recipes.
- LootJS, item, and block builders with readable generated scripts.
- A live Registry Browser with names, IDs, tags, and Minecraft item icons.
- Craft Graph with movable nodes, recipe alternatives, and totals for items, fluids, time, energy, chances, and by-products.
- The server's complete `kubejs` directory mounted in VS Code Explorer, including binary files, revisions, external change tracking, and team locks.
- Per-player `viewer`, `editor`, `operator`, and `admin` roles with one-time `/kvs join` connection codes.
- English-only runtime UI across local and remote workspaces.
- A complete Offline Mode for editing and diagnostics without a running Minecraft instance.

## Two-part installation

1. Install `kubevs-1.1.11.vsix` in Visual Studio Code.
2. Place `kubevs-connector-1.1.11.jar` in the NeoForge server's `mods` directory.
3. Start Minecraft, run `/kvs join`, and paste the copied code into **KubeVS: Connect with /kvs join code**.

The Modrinth download contains the Minecraft Connector JAR. The required VS Code extension is distributed through the [latest GitHub Release](https://github.com/Feryaq/KubeVS/releases/latest).

## Security by default

Connector listens on `127.0.0.1:32145`, requires authentication, and rejects remote clients until remote access is explicitly enabled. Use a VPN or a TLS reverse proxy for a remote server. Tokens are stored in VS Code SecretStorage; the server stores only SHA-256 digests for player credentials. See [SECURITY.md](SECURITY.md).

## Build and verify

Requires Node.js 22+, pnpm 11.9.0, and Java 21.

```powershell
pnpm install --frozen-lockfile
pnpm audit --prod
pnpm check:release
pnpm --filter kubevs-extension package:vsix
.\gradlew.bat :mods:kubevs-connector:test :mods:kubevs-connector:build --no-daemon
```

Expected artifacts:

- `apps/vscode-extension/kubevs-extension-1.1.11.vsix`
- `mods/kubevs-connector/build/libs/kubevs-1.1.11.jar`

Tagging a verified commit as `v1.1.11` runs the production release workflow and publishes only the VS Code extension VSIX to GitHub Releases. The Connector JAR remains distributed through Modrinth. Follow [the release checklist](docs/release-checklist.md).

## Documentation

- [Connector installation and dedicated servers](docs/kubevs-connector-guide-ru.md) — Russian
- [Team access and player tokens](docs/team-auth-ru.md) — Russian
- [Craft Graph](docs/craft-graph-ru.md) — Russian
- [Recipe Editor](docs/recipe-editor.md)
- [Architecture](ARCHITECTURE.md)
- [Modrinth listing copy](MODRINTH.md)

## License

KubeVS is distributed under the [KubeVS Community Source License 1.0](LICENSE). Your generated KubeJS files remain yours. See the license for source-use and distribution terms, and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for bundled components.
