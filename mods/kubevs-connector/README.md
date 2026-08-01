# KubeVS Connector

Автор: **F_ery_a228** · Telegram / Discord: **@F_ery_a**

Русская инструкция по персональным токенам, `/kvs join`, `/kvs auth` и
подключению к выделенному серверу: [`../../docs/team-auth-ru.md`](../../docs/team-auth-ru.md).

NeoForge 1.21.1, Java 21 server-safe companion mod for KubeVS.

Полная инструкция по установке, подключению, dedicated server и диагностике:
[docs/kubevs-connector-guide-ru.md](../../docs/kubevs-connector-guide-ru.md).

Status: **Beta**. The mod loads safely on a dedicated server and exposes an authenticated
WebSocket server on `127.0.0.1:32145`.

On first server start it creates `config/kubevs-connector-token.txt`. In a trusted local workspace,
**KubeVS: Connect to Minecraft** finds this file automatically. Remote users can select the file or
paste its value. The token is never written to VS Code settings.

Administrators with permission level 4 can run `/kubevs auth` for live status, a secure in-game
copy button, and confirmed token rotation without restarting the server. Console output never
prints the token itself.

Available protocol operations:

- item registry and item-tag pages;
- recipe identifiers;
- installed mod names and versions;
- bounded Connector logs;
- server resource reload when explicitly enabled;
- remote `kubejs` file read/write with revision checks and per-user edit locks;
- structured JEI/EMI recipe data and lazy exact JEI layout images on an integrated client.

Network, reload and permission options live in `config/kubevs-connector.toml`:

```toml
[network]
host = "127.0.0.1"
port = 32145
allowRemote = false

[permissions]
allowReload = false
```

For a remote dedicated server, set `host` to the server interface and explicitly enable
`allowRemote`. Use a private network, VPN or TLS-terminating reverse proxy: the Connector does not
pretend that plain WebSocket is safe on the public internet. Each teammate receives an individual
Minecraft-linked token through `/kvs join`; file locks prevent silent concurrent overwrites.

Exact JEI category windows are rendered by JEI itself, on the Minecraft client render thread, and
requested only for Craft Graph nodes that enter the viewport. A dedicated server has no JEI GUI;
there KubeVS uses RecipeManager data until a future authenticated client-visual relay is connected.

По умолчанию KubeVS создаёт JEI-layout только для видимых нод и не перебирает весь модпак.
Клиентская команда `/kvs bake` вручную запекает полный JEI-индекс пакетами по 32 рецепта за тик.
Прогресс показывается над хотбаром; повторный запуск безопасно начинает новый snapshot.

Build from the repository root:

```powershell
.\gradlew.bat :mods:kubevs-connector:build --no-daemon
.\gradlew.bat :mods:kubevs-connector:obfuscatedJar --no-daemon
```
