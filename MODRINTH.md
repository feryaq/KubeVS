# KubeVS Connector

<!-- IMAGE — LOGO
Upload apps/vscode-extension/media/kubevs-logo.png to the Modrinth project gallery, then insert its Modrinth CDN URL here:
![KubeVS logo](YOUR_MODRINTH_CDN_URL)
-->

> **Turn Visual Studio Code into a complete KubeJS workspace — with visual recipe tools, live Minecraft data, Craft Graph, LootJS builders, and secure server editing.**

KubeVS is a two-part development environment for modpack authors and server developers:

- **KubeVS Connector** runs with Minecraft and exposes the live registries, recipes, tags, icons, and KubeJS workspace.
- **KubeVS for Visual Studio Code** provides the editors, project tools, code intelligence, and remote workspace interface.

The file downloaded from Modrinth is the **Connector JAR**. The VS Code extension is also required and is available from the [latest GitHub Release](https://github.com/Feryaq/KubeVS/releases/latest).

**KubeVS is free to download and use. There are no subscriptions, paid features, license keys, or usage fees.**

<!-- SCREENSHOT 01 — HERO
Recommended: a wide 16:9 screenshot of the KubeVS Dashboard next to Minecraft.
Replace this comment with: ![KubeVS Dashboard connected to Minecraft](YOUR_IMAGE_URL)
-->

## 🧩 Build recipes visually — keep the code readable

Create and manage KubeJS recipes without memorizing every JSON shape or addon-specific field. KubeVS generates clean JavaScript that remains easy to review and edit manually.

Supported visual workflows include:

- Vanilla shaped, shapeless, smelting, blasting, smoking, and campfire cooking recipes
- Create processing recipes and Sequenced Assembly timelines
- Oritech recipes
- Farmer's Delight recipes
- Generic recipes powered by editable workspace schemas
- Multiple item and fluid inputs or outputs
- Processing time, energy, heat, chance, weight, tools, and by-products
- Safe recipe removal, replacement, and restoration by canonical recipe ID
- Readable, collision-safe generated recipe names and organized output folders

Live item, block, fluid, entity, and tag pickers use the connected Minecraft registry, including real names and item textures.

<!-- SCREENSHOT 02 — RECIPE EDITOR
Recommended: a recipe editor showing real item icons, inputs, outputs, and generated code.
Replace this comment with: ![Visual recipe editor with live Minecraft items](YOUR_IMAGE_URL)
-->

## 🕸️ Understand entire production chains with Craft Graph

Craft Graph turns the recipes from the running modpack into an interactive production tree. Choose an output, compare alternative recipes, and inspect what the complete chain actually costs.

- Smooth, freely movable recipe nodes and live connections
- Alternative crafting paths and collapsible branches
- Cycle detection and configurable depth or node limits
- Totals for base items, fluids, time, energy, chances, and by-products
- Minecraft item textures loaded from the connected game
- JEI-style tag visualization that rotates through real members of ingredients such as **#c:plates**
- Offline snapshots for previously loaded recipe data

<!-- IMAGE — CRAFT GRAPH
Upload assets/screenshots/craft-graph.png to the Modrinth project gallery, then insert its Modrinth CDN URL here:
![KubeVS Craft Graph showing connected recipe nodes with Minecraft item textures](YOUR_MODRINTH_CDN_URL)
-->

## 🎁 Create LootJS rules without fighting the syntax

The LootJS Builder provides a structured target → action → condition workflow and produces readable **LootJS.modifiers(...)** scripts.

Start from editable presets for:

- Dungeon chests
- Fishing
- Leaves and stone blocks
- Zombies and skeletons

Build rules for loot tables, blocks, and entities with:

- Add, remove, and replace loot actions
- Experience rewards
- Nested **AND**, **OR**, and **NOT** condition groups
- Random chance, tool, player-kill, and explosion conditions
- Advanced custom JSON when a preset is not enough
- Validation, model-size limits, safe diffs, and overwrite protection

<!-- SCREENSHOT 04 — LOOTJS
Recommended: the LootJS Builder with a preset selected and nested conditions expanded.
Replace this comment with: ![LootJS visual rule builder](YOUR_IMAGE_URL)
-->

## 🔎 Browse the live Minecraft registry

Search the actual data loaded by the server instead of guessing IDs from documentation.

- Items, blocks, fluids, entities, recipe types, and other registries
- Display names, **namespace:id** values, translation keys, and tags
- Real Minecraft and modded item icons
- Insert selected IDs, tag members, registry arrays, recipe JSON, or generated KubeJS directly into the editor
- Inspect the held item and generate live TypeScript declarations

Registry-aware completion also works inside JavaScript, TypeScript, and JSON strings.

<!-- SCREENSHOT 05 — REGISTRY
Recommended: Registry Browser search results with names, IDs, tags, and modded icons.
Replace this comment with: ![Live Minecraft Registry Browser](YOUR_IMAGE_URL)
-->

## 🧰 A real KubeJS development environment

KubeVS adds focused tooling to regular VS Code editing:

- Project indexing for **server_scripts**, **client_scripts**, and **startup_scripts**
- KubeJS completion, hover details, snippets, syntax highlighting, diagnostics, and Code Actions
- Live typings generated from the connected instance
- Item and block builders with readable **startup_scripts** output
- Project validation and one-command save and reload
- Dashboard plus dedicated Project, Recipes, LootJS, Registries, and Connection views
- Offline Mode for local editing, generation, indexing, and diagnostics without Minecraft

Generated files stay ordinary KubeJS source files. You can inspect, change, move, or version them like the rest of your project.

## 🌐 Edit a server workspace directly from VS Code

When connected, KubeVS can mount the server's complete **kubejs** directory in VS Code Explorer — not just generated scripts.

- Read, create, edit, rename, and delete server files
- Binary-safe file transfer
- External change detection and SHA-256 revision checks
- Atomic writes and conflict protection
- Per-file team locks with visible lock owners
- Automatic use of the correct remote **server_scripts/kubevs** path without nested **kubejs/kubejs** folders

Player access uses one-time **/kvs join** codes and the **viewer**, **editor**, **operator**, and **admin** roles. The **/kvs** command tree is only visible to Minecraft operators.

<!-- SCREENSHOT 06 — REMOTE WORKSPACE
Recommended: VS Code Explorer showing kubevs-remote files and the Connection view.
Replace this comment with: ![Remote KubeJS server workspace in VS Code](YOUR_IMAGE_URL)
-->

## 🚀 Installation

### Requirements

| Component  | Requirement                                                                       |
| ---------- | --------------------------------------------------------------------------------- |
| Minecraft  | 1.21.1                                                                            |
| Mod loader | NeoForge 21.x                                                                     |
| Java       | 21                                                                                |
| Editor     | Visual Studio Code 1.105 or newer                                                 |
| KubeJS     | Optional for registry browsing; required for creating and applying KubeJS scripts |

### Setup

1. Download **KubeVS Connector** from Modrinth and place the JAR in the server's **mods** directory.
2. Install **KubeVS for Visual Studio Code** from the [latest GitHub Release](https://github.com/Feryaq/KubeVS/releases/latest).
3. Start Minecraft and run **/kvs join** as an operator.
4. Copy the one-time connection code.
5. In VS Code, run **KubeVS: Connect with /kvs join code** from the Command Palette.
6. Open the mounted server workspace or keep working with a local KubeJS project.

## 🛡️ Secure by default

KubeVS Connector listens on **127.0.0.1:32145** by default and rejects remote clients until remote access is explicitly enabled.

- Authentication is required for every connection
- Player credentials are stored as SHA-256 digests on the server
- VS Code stores secrets in SecretStorage, not workspace settings
- Roles restrict file access and administrative operations
- Rate limits, revision checks, locks, and atomic writes protect the workspace
- Remote deployments should use a VPN or WSS through a TLS reverse proxy

The Connector's **publicHost**, **publicPort**, and **publicSecure** settings only control the address included in connection codes; they do not add TLS to the Java server.

## 🔌 Compatibility and addon detection

KubeVS detects installed integrations such as KubeJS, LootJS, Create, Oritech, and Farmer's Delight. Features that depend on a missing addon stay unavailable instead of generating scripts that cannot run in the current instance.

Custom recipe schemas make it possible to support additional modded recipe formats without changing the extension itself.

## Links

- [Download the required VS Code extension](https://github.com/Feryaq/KubeVS/releases/latest)
- [Source code and issue tracker](https://github.com/Feryaq/KubeVS)
- [Security policy](https://github.com/Feryaq/KubeVS/blob/main/SECURITY.md)
- [Contribution guide](https://github.com/Feryaq/KubeVS/blob/main/CONTRIBUTING.md)

## License

KubeVS is distributed under the [KubeVS Community Source License 1.0](https://github.com/Feryaq/KubeVS/blob/main/LICENSE). Files generated for your own KubeJS projects remain yours; see the license for source-use and distribution terms.

---

**Modrinth summary field (recommended):**

> Secure Minecraft bridge for the KubeVS visual KubeJS environment: live registries, recipes, Craft Graph, LootJS tools, and remote server editing in VS Code.

**Suggested gallery order:** Dashboard → Recipe Editor → Craft Graph → LootJS Builder → Registry Browser → Remote Workspace.
