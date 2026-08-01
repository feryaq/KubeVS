# Architecture

## Boundaries

- `apps/vscode-extension`: trusted Extension Host code and VS Code API integration.
- Dashboard webview: receives only allow-listed typed messages; it has no Node.js access.
- `packages/protocol`: transport-neutral DTOs, protocol version, and runtime guards.
- `packages/kubejs-parser`: pure, testable static analysis used by Offline Mode.
- `packages/recipe-model`: normalized Vanilla/generic recipe DTOs, validation, JSON import and
  readable KubeJS generation.
- `mods/kubevs-connector`: Java 21/NeoForge process boundary. It must remain server-safe.

The extension is useful without Minecraft. Live data will augment immutable local snapshots after
an authenticated Connector handshake; it will not replace the local project model.

## Foundation data flow

1. VS Code opens a workspace.
2. `ProjectProvider` searches bounded KubeJS script roots.
3. Paths are classified by the pure parser package.
4. Tree items open source documents through the native editor.
5. Open/changed documents are debounced and analyzed.
6. Findings are published through a VS Code diagnostic collection.

## Security baseline

- Webview scripts use a per-panel nonce and restrictive Content Security Policy.
- Webview commands are validated against an explicit allow-list.
- Connector secrets will use VS Code SecretStorage and are never settings or logs.
- Foundation's mock transport is visibly labeled and never presented as a live game connection.
