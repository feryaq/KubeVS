# KubeVS Agent Instructions

## Releases

- Before preparing or publishing any KubeVS release, read and follow `RELEASE.md` completely.
- Follow Semantic Versioning. Never reuse an existing version or published Git tag.
- Keep the root package, VS Code extension, Connector, README, and changelog versions synchronized.
- A GitHub Release must contain exactly one asset: `kubevs-<version>.vsix`.
- Never attach the Connector JAR to a GitHub Release. The Connector is distributed through Modrinth.
- Never create or push a release tag until the commit is on `main` and its CI run is successful.
- Never rewrite or delete a published release tag. If a tagged release fails, fix the issue and prepare the next patch version.
- Do not stage, commit, revert, or delete unrelated user changes while preparing a release.
