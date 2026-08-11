# Modrinth listing — KubeVS Connector

## Project title

KubeVS Connector

## Summary

Connect Minecraft to VS Code for visual KubeJS recipes, live registries, Craft Graph, and secure team editing.

## Project description

# Your KubeJS workspace, connected to the game

KubeVS Connector links a NeoForge server to the **KubeVS extension for Visual Studio Code**. Instead of switching between scripts, logs, recipe viewers, and server folders, you work from one purpose-built KubeJS environment with live Minecraft context.

## See the real modpack

Browse the server's actual items, tags, recipes, and loaded mods. Pick registry IDs without guessing, generate live typings, inspect recipes, and build a Craft Graph that exposes alternatives and base-resource costs.

## Edit the server safely

Mount the complete server-side `kubejs` folder in VS Code Explorer. KubeVS supports text and binary files, external change detection, SHA-256 revisions, and team locks designed to prevent silent overwrites.

## Build visually, keep readable scripts

Create Vanilla and modded recipes, LootJS rules, items, and blocks through focused editors. Generated output remains readable KubeJS code that belongs to your project.

## Built for teams

Each player connects with `/kvs join` and receives a role: `viewer`, `editor`, `operator`, or `admin`. Tokens can be revoked immediately. The KubeVS runtime UI also follows that player's Minecraft language—English Minecraft opens English KubeVS, Russian Minecraft opens Russian KubeVS.

## Secure defaults

- Localhost-only listener by default
- Auth required for every connection
- Remote access requires explicit opt-in
- Player tokens stored as SHA-256 digests on the server
- Credentials stored in VS Code SecretStorage
- VPN or WSS reverse proxy recommended for remote servers

## Installation

1. Download **KubeVS Connector 1.1.3** and place the JAR in the server's `mods` directory.
2. Install the companion **KubeVS 1.1.3 VSIX** from [GitHub Releases](https://github.com/Feryaq/KubeVS/releases).
3. Start the server and run `/kvs join` in Minecraft.
4. Paste the copied code into **KubeVS: Connect with /kvs join code** in VS Code.

KubeJS is optional for browsing live Minecraft data and required for creating or applying KubeJS scripts.

## Compatibility

- Minecraft 1.21.1
- NeoForge 21.x
- Java 21
- Server-side Connector; no Minecraft client installation is needed
- Visual Studio Code 1.105+ for the companion extension

## Links

- [GitHub repository](https://github.com/Feryaq/KubeVS)
- [Releases and VSIX download](https://github.com/Feryaq/KubeVS/releases)
- [Issue tracker](https://github.com/Feryaq/KubeVS/issues)
- [Security policy](https://github.com/Feryaq/KubeVS/blob/main/SECURITY.md)

## Suggested Modrinth metadata

- Project type: Mod
- Environment: Server-side
- Loader: NeoForge
- Game version: 1.21.1
- License: All Rights Reserved
- Categories: Utility, Management
- KubeJS dependency: Optional
- Version number: 1.1.3
- Version channel: Release
- Featured: Yes

## Gallery direction

Use a 16:9 hero image showing the Craft Graph in VS Code on the left and a Minecraft server connection state on the right. Keep the existing dark KubeVS palette, warm copper recipe wires, crisp item icons, and one short headline: **Your KubeJS workspace, connected.**
