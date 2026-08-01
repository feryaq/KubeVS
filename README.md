# KubeVS

Автор: **F_ery_a228** · Telegram / Discord: **@F_ery_a**

**KubeJS development, visually integrated into VS Code.**

KubeVS is a pnpm/Gradle monorepo for a native-feeling Visual Studio Code extension and a small
NeoForge 1.21.1 companion mod.

## Current status

Stage 0 (audit), Stage 1 (Extension Foundation), and the experimental Stage 2 Connector vertical are
implemented:

- strict TypeScript workspace with ESLint, Prettier, unit tests, and build scripts;
- KubeVS Activity Bar container with Project, Recipes, LootJS, Registries, and Connection views;
- theme-aware, keyboard-accessible, responsive Dashboard with a strict CSP;
- KubeJS project discovery and incremental validation for open scripts;
- clickable scripts in the Project view and diagnostics in Problems;
- Offline Mode, status bar, four output channels, settings, commands, and an explicit mock connector;
- versioned shared protocol package;
- authenticated localhost WebSocket Connector with bounded messages and rate limiting;
- live item/tag/recipe/mod counts, bounded Connector logs, capabilities and protocol negotiation;
- endpoint-scoped SecretStorage, automatic local token discovery, and permission-gated Save and
  Reload;
- dedicated-server-safe NeoForge implementation with Java-WebSocket bundled through Jar-in-Jar.
- KubeJS TextMate accents, snippets, lifecycle-aware completion, hover, document/workspace symbols,
  Problems diagnostics, and a safe missing-brace Code Action.
- ProbeJS-inspired, independently implemented registry/tag insertion, existing recipe JSON
  insertion, and live declaration generation with a native diff before replacement.
- experimental Vanilla crafting/cooking Recipe Editor, normalized recipe model, readable KubeJS
  generation, and lossless generic fallback for unknown recipe schemas.
- schema-driven Generic Recipe Editor with validated workspace schemas, nested fields, repeatable
  values, raw JSON fallback, canonical preview, and safe diff-before-write.
- Russian-language addon recipe workspace for Create, Oritech and Farmer’s Delight, including a
  reorderable Create Sequenced Assembly timeline, weighted outputs and machine parameters.
- Russian-language LootJS Builder for table, block and entity modifiers with a nested AND / OR /
  NOT condition tree, typed loot actions, live code preview and safe diff-before-write.
- searchable live registry catalog by in-game name or ID, editor pickers, source-code completion,
  Offline Mode project indexing, and a clearer Russian Activity Bar workspace with pixel icons.

Item/block builders, Registry Browser, graph, calculator, advanced fluid/energy recipes and
round-trip JavaScript import are **planned**, not stable features.

## Requirements

- Node.js 22 or newer
- pnpm 11
- Java 21

## Build and test

```powershell
pnpm install
pnpm check
.\gradlew.bat test build --no-daemon
```

Open `examples/basic-kubejs` in an Extension Development Host to exercise the first vertical
scenario.

See [ARCHITECTURE.md](ARCHITECTURE.md), [docs/getting-started.md](docs/getting-started.md), and
[docs/development.md](docs/development.md). The independent ProbeJS feature comparison is recorded
in [docs/probejs-reference.md](docs/probejs-reference.md). Custom mod recipe schemas are documented
in [docs/custom-recipe-schemas.md](docs/custom-recipe-schemas.md).
The Russian LootJS Builder guide is available in
[docs/lootjs-builder-ru.md](docs/lootjs-builder-ru.md).
Registry search and autocomplete are documented in
[docs/registry-search-ru.md](docs/registry-search-ru.md).

Русская инструкция по установке и использованию мода:
[docs/kubevs-connector-guide-ru.md](docs/kubevs-connector-guide-ru.md).
