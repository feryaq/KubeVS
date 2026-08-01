# Инструкция по KubeVS Connector

KubeVS Connector — серверный мост между Minecraft и расширением KubeVS для Visual Studio Code.
Мод передаёт расширению реальные реестры, теги, рецепты, список модов и журнал событий, а также
может запускать перезагрузку серверных ресурсов.

> Статус версии `0.4.0`: экспериментальная. Мод и расширение должны использовать совместимую
> версию протокола.

## Требования

- Minecraft `1.21.1`;
- NeoForge `21.x`;
- Java `21`;
- KubeJS-проект, открытый в Visual Studio Code;
- расширение KubeVS.

KubeVS Connector не требует установки на клиент игроков при работе с dedicated server. Сам
Connector не использует клиентские классы и безопасно загружается на выделенном сервере.

## Установка готового мода

1. Остановите Minecraft или dedicated server.
2. Скопируйте `kubevs-0.4.0.jar` в папку `mods` нужной сборки или сервера.
3. Запустите игру или сервер.
4. Для первого запуска dedicated server прочитайте Minecraft EULA и установите `eula=true` в
   `eula.txt`, если принимаете её условия.
5. Убедитесь, что в журнале появилась строка:
   ```text
   KubeVS Connector listening on 127.0.0.1:32145
   ```

При первом запуске мод создаёт секретный токен:

```text
config/kubevs-connector-token.txt
```

Не публикуйте этот файл и не добавляйте его в Git.

## Сборка из исходников

Из корня репозитория выполните:

```powershell
.\gradlew.bat :mods:kubevs-connector:build --no-daemon
```

Готовый мод будет находиться здесь:

```text
mods/kubevs-connector/build/libs/kubevs-0.4.0.jar
```

Для проверки всего проекта нужны Node.js 22+, pnpm 11 и Java 21:

```powershell
pnpm install
pnpm check
.\gradlew.bat test build --no-daemon
```

## Запуск расширения KubeVS

Пока расширение разрабатывается, его можно запустить из репозитория:

1. Выполните `pnpm install` и `pnpm build`.
2. Откройте корень репозитория KubeVS в Visual Studio Code.
3. Нажмите `F5`.
4. В окне **Extension Development Host** откройте папку своей сборки или KubeJS-проекта.
5. Нажмите значок KubeVS в Activity Bar.

Без запущенного Minecraft расширение работает в Offline Mode: индексирует
`server_scripts`, `client_scripts` и `startup_scripts`, показывает диагностику, подсказки и
доступные офлайн-редакторы.

## Подключение к Minecraft

1. Запустите Minecraft или dedicated server с установленным KubeVS Connector.
2. Откройте любую удобную папку в Visual Studio Code.
3. Откройте палитру команд через `Ctrl+Shift+P`.
4. Выполните **KubeVS: Connect to Minecraft**.

В доверенном workspace расширение само найдёт `config/kubevs-connector-token.txt`. Если найдено
несколько сборок, выберите нужную из короткого списка. Для удалённого сервера выберите token-файл
вручную или вставьте токен.

После успешного подключения токен хранится в VS Code SecretStorage, а не в `settings.json`.
Секрет привязан к адресу и порту Connector. Стандартное подключение использует:

```json
{
  "kubevs.connector.host": "127.0.0.1",
  "kubevs.connector.port": 32145,
  "kubevs.connector.autoConnect": false,
  "kubevs.connector.autoOpenWorkspace": true,
  "kubevs.connector.prepareWorkspace": true
}
```

Connector передаёт канонический путь локального экземпляра после защищённой авторизации. KubeVS
создаёт недостающие `server_scripts`, `client_scripts`, `startup_scripts`,
`server_scripts/kubevs` и `.kubevs/cache`, а затем открывает саму папку `kubejs` в
текущем окне VS Code. Существующие файлы не перезаписываются. Для Connector на другом компьютере
автоматическое открытие пропускается, если переданного пути нет на локальной машине.

Чтобы заменить сохранённый токен, выполните **KubeVS: Change Connector Token**. Если сохранённый
токен отклонён сервером, KubeVS удалит его и сразу откроет выбор нового.

## Удобное управление авторизацией в игре

Администратор с уровнем прав 4 может выполнить:

```text
/kubevs auth
```

Команда показывает адрес Connector, количество подключённых клиентов и две кнопки:

- **Copy token** — копирует токен в буфер обмена, не публикуя его в чате или журнале;
- **Rotate** — после подтверждения атомарно создаёт новый токен и сразу активирует его.

После ротации текущие подключения закрываются. Перезапуск Minecraft не нужен: расширение сможет
заново найти обновлённый token-файл. В dedicated-server console секрет не выводится — там
показывается только путь к `config/kubevs-connector-token.txt`.

Для автоматического локального подключения включите:

```json
"kubevs.connector.autoConnect": true
```

Состояние соединения отображается в Status Bar и в представлении **Connection**. Для подробностей
выполните **KubeVS: Show Connection Diagnostics** и откройте каналы **KubeVS** и
**KubeVS Connector** в панели Output.

## Save and Reload

По умолчанию удалённая перезагрузка отключена. Чтобы разрешить её владельцу сервера, откройте
`config/kubevs-connector.toml` и измените:

```toml
[permissions]
allowReload = true
```

После изменения конфигурации полностью перезапустите Minecraft или dedicated server.

После подключения выполните **KubeVS: Save and Reload**. Команда:

1. сохраняет открытые файлы;
2. запускает доступную статическую проверку;
3. предупреждает о найденных ошибках;
4. предупреждает, если изменены `startup_scripts`;
5. запрашивает серверную перезагрузку;
6. показывает результат только после ответа Connector.

Обычный reload не применяет `startup_scripts`: для них требуется полный перезапуск Minecraft или
сервера.

## Доступные команды

Работают офлайн:

- **KubeVS: Open Dashboard**;
- **KubeVS: Refresh Project**;
- **KubeVS: Validate Project**;
- **KubeVS: Create Recipe** — визуальный редактор Vanilla shaped, shapeless и cooking-рецептов.

Требуют подключения к Connector:

- **KubeVS: Insert Registry Array**;
- **KubeVS: Insert Tagged Registry Values**;
- **KubeVS: Insert Recipe JSON**;
- **KubeVS: Insert Existing Recipe as KubeJS**;
- **KubeVS: Generate Live Typings**;
- **KubeVS: Save and Reload**.

Live typings создаются в:

```text
.kubevs/generated/registries.d.ts
```

Сгенерированные рецепты по умолчанию сохраняются в:

```text
kubejs/server_scripts/kubevs
```

Перед заменой существующего управляемого файла KubeVS открывает diff и запрашивает явное
подтверждение.

## Настройки Connector

NeoForge автоматически создаёт `config/kubevs-connector.toml` после первого запуска:

```toml
[network]
host = "127.0.0.1"
port = 32145
allowRemote = false

[permissions]
allowReload = false
joinPermissionLevel = 2
```

Порт ограничен диапазоном `1024–65535`, а уровень прав `/kvs join` — диапазоном `0–4`.
После изменения `network.port` укажите то же значение в `kubevs.connector.port` внутри VS Code и
полностью перезапустите Minecraft или сервер.

## Удалённый dedicated server

По умолчанию Connector принимает только локальные подключения. Это безопасный рекомендуемый
режим.

Не открывайте порт Connector напрямую в интернет. Транспорт `ws://` не шифрует токен. Для
удалённого сервера используйте доверенный SSH- или TLS-туннель и оставляйте Connector привязанным
к `127.0.0.1`. Например, локальная сторона туннеля может публиковать серверный порт `32145` как
`127.0.0.1:32145`, после чего VS Code подключится к нему как к локальному серверу.

Привязка к сетевому адресу включается только явно:

```toml
[network]
host = "192.0.2.10"
allowRemote = true
```

Такой режим меняет границу доверия и требует отдельной защиты сети. При ручном подключении к
нелокальному адресу расширение покажет предупреждение.

## Безопасность

- токен содержит 256 бит случайных данных;
- токен создаётся атомарно и не записывается в журнал;
- неавторизованные подключения закрываются до выполнения запросов;
- размер сообщения ограничен 1 МиБ;
- разрешено не более 30 запросов за 10 секунд на одно соединение;
- ответы со списками разбиваются на страницы;
- reload требует отдельного разрешения владельца сервера.

Если токен стал известен постороннему, остановите сервер, удалите
`config/kubevs-connector-token.txt` и запустите сервер снова. Будет создан новый токен. Затем
выполните **KubeVS: Change Connector Token** и выберите новый файл.

## Решение проблем

### Расширение остаётся в Offline Mode

Проверьте:

- Minecraft или сервер полностью запущен;
- в журнале есть строка `KubeVS Connector listening`;
- адрес и порт совпадают в моде и VS Code;
- токен скопирован без лишних пробелов;
- порт не занят другим процессом;
- локальный firewall не блокирует Java или VS Code.

Запустите **KubeVS: Show Connection Diagnostics** и проверьте Output → **KubeVS Connector**.

### `Authentication failed`

Токен в VS Code не совпадает с текущим токеном сервера. KubeVS автоматически удалит отклонённый
секрет и предложит выбрать новый. При необходимости выполните **KubeVS: Change Connector Token**.

### `Connector reload permission is disabled`

В `config/kubevs-connector.toml` установите `permissions.allowReload = true` и полностью
перезапустите сервер.

### `Refusing non-loopback bind`

В `network.host` указан сетевой адрес, но `network.allowRemote` выключен. Рекомендуется вернуть
`127.0.0.1` и использовать защищённый туннель.

### Изменения в `startup_scripts` не применились

Это ожидаемое поведение KubeJS. Полностью перезапустите Minecraft или dedicated server.

### Порт уже занят

Выберите свободный порт:

```toml
[network]
port = 32146
```

И установите `"kubevs.connector.port": 32146` в настройках VS Code.

## Удаление

1. Остановите Minecraft или dedicated server.
2. Удалите `kubevs-0.1.0.jar` из папки `mods`.
3. При необходимости удалите `config/kubevs-connector-token.txt`.
4. Удалите или отключите расширение KubeVS в Visual Studio Code.

Удаление Connector не изменяет KubeJS-скрипты и сгенерированные файлы проекта.
