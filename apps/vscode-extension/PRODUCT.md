# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Minecraft modpack authors and KubeJS developers who work in Visual Studio Code and want to edit
scripts, recipes, and mod data without repeatedly looking up formats and registry IDs.

## Product Purpose

KubeVS turns Visual Studio Code into a focused KubeJS environment that combines regular code,
visual editors, project indexing, and verified data from a running Minecraft instance. The product
succeeds when a complex recipe or rule can be assembled visually, reviewed, and saved as readable
code without giving up control over project files.

## Positioning

Unlike a standalone generator, KubeVS lives inside VS Code, works offline, and enriches the local
project with verified Minecraft registry snapshots through the authenticated KubeVS Connector.

## Operating Context

- Visual Studio Code on Windows and other supported platforms.
- KubeJS projects with server_scripts, client_scripts, and startup_scripts.
- Minecraft 1.21.1 with NeoForge and the optional KubeVS Connector.
- Create, Oritech, Farmer's Delight, LootJS, and other addons with custom recipe formats.

## Capabilities and Constraints

- The interface stays native to VS Code and respects its themes, focus model, keyboard navigation,
  and standard dialogs.
- Minecraft-inspired accents may provide functional context but must not reduce readability.
- Every overwrite of a user file requires a safe diff and explicit confirmation.
- Offline Mode remains fully usable; live features clearly state their Connector dependency.
- All user-facing text and primary documentation are authored in English.
- Generated KubeJS must remain readable and suitable for manual editing.

## Brand Commitments

The product names are KubeVS and KubeVS Connector. Commands use the KubeVS: prefix, settings use
kubevs.*, and generated files live in KubeVS-managed directories. The product should feel like a
professional production tool, not a demonstration prototype.

## Evidence on Hand

The repository contains Extension Host tests, a NeoForge dedicated-server path, an authenticated
WebSocket protocol, Vanilla and Generic Recipe Editors, custom schemas, and safe writes through
native diffs. Commercial testimonials, pricing claims, and marketing proof are not available and
must not be invented.

## Product Principles

1. Code remains primary and readable.
2. Complexity is disclosed progressively, while frequent actions stay fast.
3. Minecraft verifies live data; offline capabilities never pretend to be live.
4. Overwrites are safe and reversible until confirmation.
5. The interface uses clear English and familiar Minecraft terminology.

## Accessibility & Inclusion

The interface supports keyboard operation, visible focus, VS Code themes, forced colors, zoom, and
clear error states that do not rely on color alone.
