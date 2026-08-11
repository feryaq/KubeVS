# Production release checklist

## Before tagging

- The release commit is reviewed on `main`; unrelated local changes are excluded.
- Root, extension, and Connector versions all match.
- `CHANGELOG.md` explains the user-visible changes, their location, and why the previous behavior changed.
- `pnpm install --frozen-lockfile`, `pnpm audit --prod`, and `pnpm check:release` pass.
- `gradlew :mods:kubevs-connector:test :mods:kubevs-connector:build --no-daemon` passes.
- `vsce ls --no-dependencies` contains no source files, tests, source maps, temporary files, or unlicensed assets.
- The staged diff contains no tokens, logs, caches, local configuration, VSIX files, or ordinary build JARs.

## Release

1. Create a signed `v<version>` tag on the verified `main` commit.
2. Push the tag. The Release workflow rebuilds the VSIX and Connector JAR and publishes both to GitHub Releases.
3. Compare the downloaded artifact hashes with the workflow output.
4. Install the VSIX in a clean VS Code profile and verify Offline Mode.
5. Run the JAR on a clean dedicated server and verify localhost-only defaults, `/kvs join`, roles, localization, and Save and Reload.
6. With two VS Code clients, verify create/write/rename/delete, lock ownership, revision conflicts, and a binary PNG round-trip.
7. Upload the Connector JAR to the prepared Modrinth project as a **Release** for Minecraft 1.21.1 / NeoForge; link the GitHub VSIX download prominently.
8. Announce the release only after the smoke tests pass.

The experimental `JEI-integration` branch is not part of the production release from `main`.
