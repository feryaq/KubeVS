# Установка KubeVS Connector

Актуально для Connector 1.1.0, Minecraft 1.21.1, NeoForge 21.x и Java 21.

## Что устанавливать

Connector ставится только на dedicated server или в локальную Minecraft-сборку. Игрокам не нужен
клиентский мод. В VS Code устанавливается KubeVS Extension 1.1.0.

1. Остановите сервер.
2. Скопируйте `kubevs-1.1.0.jar` в `mods`.
3. Примите Minecraft EULA в `eula.txt`, если согласны с ней.
4. Запустите сервер.
5. Проверьте строку `KubeVS Connector listening on ...`.

## Локальный сервер

Безопасные значения по умолчанию:

```toml
[network]
host = "127.0.0.1"
port = 32145
allowRemote = false
publicHost = ""
publicPort = 0
publicSecure = false

[permissions]
allowReload = false
joinPermissionLevel = 2
defaultRole = "EDITOR"
```

В игре выполните `/kvs join`, скопируйте код и вставьте его в команду VS Code
**KubeVS: Подключиться по коду /kvs join**. После подключения серверная папка KubeJS автоматически
появится в Explorer.

## FalixNodes и другие игровые панели

Connector использует отдельный TCP WebSocket и не может делить порт с Minecraft. В панели Falix
откройте **Network → Ports → Add Port**, создайте дополнительный allocation и укажите именно его
в `network.port`. Основной адрес Minecraft использовать нельзя.

Пример, если панель выделила дополнительный порт `20002`:

```toml
[network]
host = "0.0.0.0"
port = 20002
publicHost = "eu20-free.falixserver.net"
publicPort = 20002
publicSecure = false
allowRemote = true
```

После полного перезапуска в консоли должна появиться строка
`KubeVS Connector listening on 0.0.0.0:20002`. Если бесплатный тариф не позволяет создать второй
TCP allocation, одновременно держать Minecraft и Connector на одном публичном порту невозможно:
потребуется дополнительный порт, VPN или TCP-туннель.

## Dedicated server через VPN

Привяжите Connector к адресу VPN-интерфейса:

```toml
[network]
host = "10.8.0.5"
port = 32145
allowRemote = true
publicHost = "10.8.0.5"
publicPort = 32145
publicSecure = false
```

Разрешайте порт только внутри VPN. VS Code покажет подтверждение подключения без TLS.

## Dedicated server через TLS reverse proxy

Рекомендуемая схема для домена:

```text
VS Code -- wss://kubevs.example.com:443 --> reverse proxy -- ws://127.0.0.1:32145 --> Connector
```

```toml
[network]
host = "127.0.0.1"
port = 32145
allowRemote = false
publicHost = "kubevs.example.com"
publicPort = 443
publicSecure = true
```

Reverse proxy обязан поддерживать WebSocket Upgrade и валидный TLS-сертификат. Connector остаётся
недоступен напрямую из интернета.

## Роли

- `viewer`: просмотр;
- `editor`: полный файловый CRUD;
- `operator`: CRUD, logs и разрешённый reload;
- `admin`: все возможности Connector.

Администратор управляет аккаунтами командами `/kvs users`, `/kvs role` и `/kvs revoke`.
Подробности: [team-auth-ru.md](team-auth-ru.md).

## Save and Reload

Включите:

```toml
[permissions]
allowReload = true
```

Reload доступен только ролям `operator` и `admin`. Изменения в `startup_scripts` всё равно
требуют полного перезапуска сервера.

## Диагностика

- **Authentication failed**: выполните `/kvs join` повторно и вставьте новый код.
- **Роль разрешает только чтение**: администратор должен назначить `editor` или выше.
- **Файл занят**: откройте Connection View и посмотрите владельца блокировки.
- **Файл изменился на сервере**: сравните несохранённый буфер с новой ревизией.
- **Refusing non-loopback bind**: для сетевого bind включите `allowRemote`.
- **ECONNREFUSED**: проверьте firewall, bind, publicHost и publicPort.
- **Opening handshake has timed out**: убедитесь, что адрес ведёт на отдельный Connector TCP allocation, а не на игровой порт Minecraft.
- **Ошибка TLS**: проверьте сертификат и WebSocket Upgrade reverse proxy.

Токены не должны попадать в Git, логи или тикеты. При компрометации личного токена выполните
`/kvs revoke <игрок>`; для админ-токена — `/kvs auth rotate`.
