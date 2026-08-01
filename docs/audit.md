# Stage 0 audit — 2026-07-29

## Initial state

The repository contained only a NeoForge MDK project. It was not a Git repository and had no
license file, Java tests, Node workspace, extension, protocol, documentation, or CI configuration.

The baseline `gradlew test build` succeeded but `test` reported `NO-SOURCE`. Compilation emitted
four deprecation warnings. The generated mod still registered MDK example items/blocks and loaded
`net.minecraft.client.Minecraft` from its main source set, so it was not a valid dedicated-server
Connector. Metadata described an unrelated Lootr stack-overflow fix and used `All Rights Reserved`.

## Verified environment and versions

- Java: Temurin 21.0.11
- Node.js: 24.18.0
- pnpm: 11.9.0
- Minecraft: 1.21.1
- NeoForge: 21.1.244
- ModDevGradle: 2.0.143
- Parchment properties: Minecraft 1.21.11 / mappings 2025.12.20

Version values are pinned in workspace manifests. The Parchment/Minecraft difference is retained
from the successful baseline and must be revalidated before release.

## Gap analysis

Stage 1 was entirely absent. Stages 2–9 were also absent; none of the visual builders, integrations,
live registry data, language services, graph, calculator, or secure network capabilities existed.

The Stage 1 implementation establishes one complete offline vertical: detect KubeJS scripts, show
them in a native Tree View, open on click, analyze open/changed source, and publish basic findings to
Problems.
