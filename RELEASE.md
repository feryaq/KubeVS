# KubeVS Release Runbook

This is the required procedure for ChatGPT, Codex, and human maintainers publishing a new KubeVS release.

## Release contract

- Versions use Semantic Versioning: `major.minor.patch`.
- The root package, VS Code extension, Connector, README, and changelog use the same version.
- Pushing a new `v<version>` tag starts `.github/workflows/release.yml`.
- GitHub Releases distribute both the VS Code extension and the Connector.
- A completed release must contain exactly two assets named `kubevs-<version>.vsix` and `kubevs-connector-<version>.jar`.
- The Connector JAR must be tested and built from the tagged commit; Modrinth distribution is optional.
- Published tags are immutable. Never reuse, move, or delete one.

## 1. Choose and synchronize the version

Confirm that the version and tag do not already exist, then update all release metadata:

- `package.json`
- `apps/vscode-extension/package.json`
- `gradle.properties` (`mod_version` only)
- `README.md`
- `mods/kubevs-connector/README.md`
- `CHANGELOG.md`
- `docs/releases/<version>.md` (prepared Russian release description)

Keep the public README files and the release description in Russian. The extension UI remains English. The release workflow publishes the prepared Markdown file with `--notes-file`; do not substitute automatically generated English notes.

```powershell
git fetch origin --tags
git tag --list "v<version>"
gh release view "v<version>"
pnpm verify:release
```

Both tag/release checks must confirm that the new version is unused. `pnpm verify:release` must report matching extension and Connector versions.

## 2. Validate production inputs

```powershell
pnpm install --frozen-lockfile
pnpm audit --prod
pnpm check:release
.\gradlew.bat :mods:kubevs-connector:test :mods:kubevs-connector:build --no-daemon
pnpm --filter kubevs-extension exec vsce package --no-dependencies --out "../../artifacts/kubevs-<version>.vsix"
Copy-Item "mods/kubevs-connector/build/libs/kubevs-<version>.jar" "artifacts/kubevs-connector-<version>.jar"
```

Do not claim success from compilation alone. All checks must pass. Inspect `git status --short` and preserve unrelated user changes.

## 3. Commit and verify `main`

Stage only the intended release files, commit, and push normally. Never force-push. Replace placeholders before running commands.

```powershell
git status --short
git add -- <exact-release-files>
git diff --cached --check
git commit -m "release: prepare KubeVS <version>"
git push origin main
gh run list --workflow CI --branch main --limit 3
gh run watch <ci-run-id> --exit-status
```

Do not create the release tag until both CI jobs are successful.

## 4. Trigger the release

Create an annotated tag on the exact verified commit and push only that tag:

```powershell
git tag -a "v<version>" <verified-commit-sha> -m "KubeVS <version>"
git push origin "v<version>"
```

The Release workflow has no manual `workflow_dispatch` button. The pushed `v*` tag is the trigger.

## 5. Wait for publication and verify the asset

```powershell
gh run list --workflow Release --limit 3
gh run watch <release-run-id> --exit-status
gh release view "v<version>" --json name,tagName,url,isDraft,isPrerelease,assets
```

The final verification must confirm:

- the workflow conclusion is `success`;
- the release is public, not a draft or prerelease unless explicitly requested;
- the tag is `v<version>`;
- there are exactly two assets;
- their names are `kubevs-<version>.vsix` and `kubevs-connector-<version>.jar`;
- SHA-256 digests are verified for both assets.

Report the release page, direct VSIX and JAR download links, workflow result, commit SHA, and SHA-256 digest of each asset.

## Failed tagged release

Do not rewrite the failed tag. Fix the cause on `main`, increment to the next patch version, repeat every validation step, and publish a new tag.
