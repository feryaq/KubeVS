# KubeVS Release Runbook

This is the required procedure for ChatGPT, Codex, and human maintainers publishing a new KubeVS release.

## Release contract

- Versions use Semantic Versioning: `major.minor.patch`.
- The root package, VS Code extension, Connector, README, and changelog use the same version.
- Pushing a new `v<version>` tag starts `.github/workflows/release.yml`.
- GitHub Releases distribute only the VS Code extension.
- A completed release must contain exactly one asset named `kubevs-<version>.vsix`.
- The Connector JAR is tested by CI but distributed through Modrinth, never through GitHub Releases.
- Published tags are immutable. Never reuse, move, or delete one.

## 1. Choose and synchronize the version

Confirm that the version and tag do not already exist, then update all release metadata:

- `package.json`
- `apps/vscode-extension/package.json`
- `gradle.properties` (`mod_version` only)
- `README.md`
- `mods/kubevs-connector/README.md`
- `CHANGELOG.md`

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
- there is exactly one asset;
- its name is `kubevs-<version>.vsix`;
- no JAR is attached.

Report the release page, direct VSIX download link, workflow result, commit SHA, and asset SHA-256 digest.

## Failed tagged release

Do not rewrite the failed tag. Fix the cause on `main`, increment to the next patch version, repeat every validation step, and publish a new tag.
