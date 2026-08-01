# Development

## TypeScript

```powershell
pnpm install
pnpm lint
pnpm test
pnpm build
pnpm format:check
```

If VS Code is installed but `code` is not on `PATH`, integration tests can reuse it without a
download:

```powershell
$env:KUBEVS_VSCODE_EXECUTABLE_PATH = 'C:\Path\To\Microsoft VS Code\Code.exe'
pnpm --filter kubevs-extension test
```

## Connector

```powershell
.\gradlew.bat :mods:kubevs-connector:test :mods:kubevs-connector:build --no-daemon
```

Long-running `runClient` and `runServer` tasks are intentionally separate from build verification.
