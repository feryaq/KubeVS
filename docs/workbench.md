# Workbench

Click the KubeVS cube in the Activity Bar to open the full workbench automatically. Its sidebar contains the same searchable tools, connection and project actions. **KubeVS: Open Dashboard** remains available in the Command Palette. Search filters the available tools; Enter opens the first result. Project files and diagnostics come from your actual workspace. Local editors stay available offline; missing KubeJS on a connected server disables script creation.

Visual editors show readable JavaScript before saving. **Copy** sends the exact current preview to the clipboard. Ctrl/Cmd+S uses the editor’s existing validation and save action. Existing generated files require a diff and confirmation. Item/block startup changes require a Minecraft restart.

## Live Minecraft

Run `/kvs join` in Minecraft, click **Connect Minecraft** on the KubeVS home screen, and paste the copied code. The owner of a singleplayer world can do this without enabling cheats. The code is cleared from the form immediately and is never stored in webview state. **Use token…** uses a saved/local administrator token; **Settings** opens the native VS Code extension settings. Roles control remote reading, writing, management and reload. **Check Connection** measures a complete request round trip and reads a privacy-safe status snapshot when the Connector supports it. Older protocol-2 Connectors fall back to a lightweight registry request.

**Inspect Held Item** copies the current main-hand item ID. It requires an online player and a personal session; an administrator token alone does not identify a player. **Import Recipe JSON** selects one JSON recipe, validates it and writes a readable KubeJS script under a chosen ID.

## Registries and graphs

Registry Browser searches names, IDs and tags, pages results and shows tag members. Offline results are labeled as project IDs/built-in samples, not live Minecraft data. The full ID remains available through entry selection and Copy ID even when the list truncates long strings.

Craft Graph computes resource quantities, alternatives and by-products from recipe snapshots. Automatic nodes are packed according to measured heights; manually moved positions are preserved. Copy Resources includes quantities and fluid units. Resources and Details remain accessible through drawers in narrow panels. Arbitrary custom recipe formats may need dedicated normalization or a schema; the graph does not simulate every mod’s machinery.

## Verification

- TypeScript lint/type checks and unit tests cover shared models, lexical diagnostics, generated-code semantics, protocol guards and socket lifecycle/races.
- Java tests cover configuration, permissions, token stores, file revisions/locks and request envelopes.
- `test/workbenchRender.mjs` bundles the actual webview functions and preview generators for focus-safe rendering. It substitutes only VS Code messaging/theme values and explicit registry/recipe fixtures.
- `test/workbenchVisual.mjs` uses headless Playwright to check responsive layout, themes, script errors and interactions. It needs Playwright/browser availability; normal application use does not.
- `test/run.mjs` can run the installed Code executable through `KUBEVS_VSCODE_EXECUTABLE_PATH`. It uses disposable workspace, profile and extension directories. For private-Xvfb testing, set `DISPLAY`, unset Wayland variables and set `KUBEVS_ISOLATED_DISPLAY=1` so the test runner forces X11. These are test-only controls.

The installed-Code suite uses a mock Connector for remote filesystem scenarios. It does not establish behavior inside a real Minecraft session. The lexical analyzer does not execute JavaScript or replace the game’s own error reporting.
