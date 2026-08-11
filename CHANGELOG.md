# Changelog

Notable KubeVS changes. This file records product decisions instead of repeating commit history.

## [Unreleased]

---

## [1.1.4 / Connector 1.1.4] — 2026-08-11

### English-only extension

- Converted all extension UI, accessibility labels, errors, documentation, and tests to native English source text.
- Removed the Russian locale bundle and disabled runtime locale switching.
- Removed public creator, Telegram, and Discord promotion from extension-facing metadata and documentation.
- Added a release guard that rejects Cyrillic extension sources and Russian locale files.

---

## [1.1.3 / Connector 1.1.3] — 2026-08-11

### Operator-only commands and canonical recipes

- `/kvs` and `/kubevs` are now gated at the root Brigadier node by command permission level 2, so non-operators neither see nor execute the command tree.
- Converted every player-facing command, role, workspace error, and Connector audit message in the Minecraft mod to English.
- Replaced opaque hash-based automatic recipe IDs with readable IDs derived from output, process, and primary ingredient.
- Generated recipe filenames now remain collision-safe through readable namespace and path separators instead of hash suffixes.
- Granted level-4 operator access to `F_ery_a228` in the local offline-mode test server.

---

## [1.1.2 / Connector 1.1.2] — 2026-08-11

### Remote generated files

- Fixed recipe, LootJS, and content generation in `kubevs-remote://server/` workspaces.
- The mounted remote root already represents the server `kubejs` directory, so generated files now target `server_scripts/kubevs/...` instead of creating a nested `kubejs/server_scripts/...` tree.
- Added a regression test for the remote workspace URI scheme.

---

## [1.1.1 / Connector 1.1.1] — 2026-08-11

### Component branches

- Preserved the verified extension release on `codex/vscode-extension-1.1.0`.
- Added `codex/minecraft-connector-1.1.1` for Connector-specific work while keeping the complete monorepo and shared protocol available to both branches.

### Minecraft command interface

- **What:** rebuilt the `/kvs` status, join, account, role, revoke, and token messages around a consistent semantic chat palette.
- **Where:** `ConnectorAuthCommands` and Connector release metadata.
- **Why:** the previous output mixed gold, aqua, gray, and decorative symbols without a stable meaning, while long messages hid the next action.
- **Before:** users saw implementation-oriented account/token wording; errors often named the failure without explaining recovery.
- Aqua now identifies KubeVS and interactive actions, green confirms success, gold warns about sensitive changes, red marks destructive actions, and gray/white separate labels from values.
- `/kvs join` now presents a numbered two-step connection flow, a shorter copy action, and an explicit one-time-code warning.
- Empty, permission, missing-account, and unavailable-Connector states now tell the player what to do next.

---

## [1.1.0 / Connector 1.1.0] — 2026-08-11

### Stable Modrinth and GitHub release

- **What:** unified the VS Code extension and Connector under stable version 1.1.0, added English release copy, Modrinth metadata, GitHub issue/PR templates, and reproducible artifact naming.
- **Where:** package manifests, NeoForge metadata, public READMEs, release workflow inputs, and publishing documentation.
- **Why:** the first Modrinth release needs one product version and a clear two-part installation path for the Connector JAR and companion VSIX.
- **Before:** the extension and Connector used unrelated pre-release version numbers and the main public descriptions were Russian-only.

### Minecraft-driven localization

- The Connector handshake now includes the language reported by the player authenticated through `/kvs join`.
- KubeVS runtime views, number formatting, Dashboard, and Craft Graph select English or Russian from that player session and return to the VS Code locale after disconnecting.
- Static VS Code manifest labels keep English as the release baseline because VS Code resolves `package.nls` before a Minecraft connection exists.

### Craft Graph

- Node dragging now uses compositor transforms and schedules wire updates once per animation frame, removing the stepped movement caused by synchronous SVG rebuilds on every pointer event.
- Tag ingredients request their real item members from Minecraft and rotate randomly through cached item textures, JEI-style, while calculations continue to preserve the tag itself.
- Remote recipe creation and live recipe snapshots use the connected server workspace reliably.

### LootJS presets

- Added editable starter presets for dungeon chests, fishing, leaves, stone, zombies, and skeletons.
- Every preset is validated by the same generator as manually authored rules and remains fully editable before saving.

---

## [0.11.3 / Connector 0.8.1] — 2026-08-11

### Исправление бесконечной активации remote workspace

- Индекс проекта больше не вызывает `workspace.findFiles` для `kubevs-remote`: VS Code ожидает SearchProvider для пользовательской схемы и раньше мог оставаться на `Activating Extensions…` бесконечно.
- Локальная индексация запускается в фоне и не зависит от Minecraft; удалённые JS/TS-файлы обходятся через FileSystemProvider только после успешного подключения.
- Для `kubevs-remote` добавлено раннее событие `onFileSystem`, поэтому провайдер регистрируется при восстановлении серверной папки.
- Современный Connector с `workspaceFiles` больше не попадает в legacy-ветку `vscode.openFolder`, которая могла неожиданно перезапустить окно после соединения.
- Добавлен live-тест настоящего VS Code Extension Host: открытый remote workspace, WebSocket-авторизация и полный write/read/delete серверного файла.
- Connector теперь явно отклоняет конфигурацию, где
  etwork.port совпадает с игровым Minecraft TCP-портом, и объясняет необходимость отдельного hosting allocation.

---

## [0.11.2 / Connector 0.8.0] — 2026-08-11

### Неблокирующее подключение и production-интерфейс

- **Что:** активация VS Code завершается до сетевой синхронизации; автоподключение и монтирование серверной папки продолжаются в фоне с отдельными состояниями loading, success и error.
- **Где:** основной extension host, Connection View, Recipes View, Dashboard и remote workspace provider.
- **Почему:** успешный WebSocket уже мог работать, пока VS Code оставался на `Activating Extensions…`; ожидание сети внутри `activate()` делало весь продукт визуально зависшим.
- **Было:** `activate()` ожидал Connector, registry bootstrap и workspace mount; открытый WebSocket без `hello` также не имел общего таймаута.

### Localization and brand

- Manifest-команды, views и настройки, а также основной runtime-интерфейс теперь имеют английскую базу и русский `package.nls` / `vscode.l10n` bundle.
- Новый официальный логотип используется как иконка расширения и центральный элемент Dashboard; нативные Activity Bar icons остаются theme-aware.
- Recipes View сгруппирован по задачам «Создание / Инструменты / Управление», чтобы частые действия не терялись в плоском списке.

### Connector distribution

- ProGuard удалён из production toolchain. Стандартный ModDevGradle JAR выбран ради прозрачной диагностики и совместимости с NeoForge; прежняя отдельная obfuscated-сборка больше не создаётся и не публикуется.
- Release-gate проверяет отсутствие обфускации, наличие RU/EN-локализации и официального logo asset.

---

## [0.11.0 / Connector 0.8.0] — 2026-08-09

### Remote KubeJS workspace

- Серверная папка `kubejs` монтируется в Explorer VS Code как обычная рабочая папка.
- Реализованы бинарно-безопасные read/write, создание папок, copy, rename и recursive delete.
- Изменения других клиентов и внешних редакторов обнаруживаются событиями и polling без перезапуска.
- SHA-256-ревизии, атомарная запись и блокировки дерева предотвращают молчаливую потерю изменений.
- Доступ ограничен sandbox-папкой `<server>/kubejs`; traversal и symlink запрещены.

### Roles and authentication

- Безымянные уровни заменены ролями `viewer`, `editor`, `operator`, `admin` с явными permissions.
- `/kvs join` выдаёт единый код подключения, который вставляется в команду VS Code «Подключиться по коду».
- Токен игрока показывается один раз; на сервере сохраняется только SHA-256 digest.
- Добавлены `/kvs users`, `/kvs role <player> <role>` и `/kvs revoke <player>`.
- Смена роли, повторная выдача или отзыв немедленно закрывают прежние сессии.
- Dedicated server поддерживает отдельные `publicHost`, `publicPort` и `publicSecure` для VPN/TLS proxy.

---

## [0.10.1 / Connector 0.7.2] — 2026-08-09

### Production-ready distribution

- **Что:** стабильная `main` получила воспроизводимые CI/release workflows, коммерческую лицензию,
  SECURITY policy, release checklist и проверку согласованности версий.
- **Где:** `.github`, `scripts/verify-release.mjs`, релизные манифесты и документация.
- **Почему:** ручная локальная сборка не доказывала воспроизводимость и могла упаковать лишние assets.
- **Было:** README описывал реализованные функции как planned, MIT разрешала свободную перепродажу,
  а PNG без подтверждённой лицензии попадали в исходное дерево и VSIX.

### Changed

- Craft Graph лениво запрашивает иконки только для нод около видимой области.
- UI использует собственный SVG KubeVS и нативные Codicons вместо assets с неизвестной лицензией.
- GitHub Release по тегу собирает minified VSIX и обфусцированный Connector JAR.

### Fixed

- Пагинация recipe snapshot аварийно останавливается, если Connector перестал двигать offset.
- Исправлен ESLint-блокер в Unicode-регулярном выражении Craft Graph.

## 0.10.0 / Connector 0.7.0

- Rebuilt Craft Graph as a movable, pannable and zoomable node canvas with persisted positions.
- Fixed tag ingredients being expanded into every tag member in resource totals and graph nodes.
- Added release minification/obfuscation and author metadata for F_ery_a228 (`@F_ery_a`).
- Verified remote workspace write, revision round-trip and two-client file-lock handoff against a
  live dedicated server.

## 0.9.0

- Craft Graph показывает канонические названия операций, станки, жидкости и игровые иконки;
  данные и иконки загружаются постранично и лениво, Offline Mode сохранён.
- Recipe Builder поддерживает жидкостные входы и результаты Create Mixing/Compacting в mB,
  поиск по реестру жидкостей, автоматические иконки и строгую проверку формата NeoForge.
- Порт, адрес, удалённый доступ, reload и уровень прав `/kvs join` перенесены из JVM-флагов в
  автоматически создаваемый `config/kubevs-connector.toml`.

## 0.8.0

- Удаление и восстановление рецептов выполняются строго по recipe ID через managed-файл без
  второго диалога сохранения.
- Добавлена быстрая замена существующего рецепта другим с сохранением исходного ID.
- Рецепты автоматически раскладываются по `server_scripts/kubevs/crafts/<integration>`, правила
  LootJS — по `server_scripts/kubevs/lootjs`.
- KubeVS определяет наличие KubeJS, LootJS, Create, Oritech и Farmer's Delight и блокирует
  несовместимые live-действия.
- LootJS Builder упрощён до последовательности «цель → действие → условия».
- Connector 0.5.0 получил персональные токены игроков, `/kvs join`, `/kvs auth`, фактический порт,
  идентичность сессии и безопасный opt-in для удалённых подключений.
- Добавлено командное редактирование существующих серверных файлов через VS Code: персональные
  права, блокировки с именем владельца, SHA-256-ревизии и атомарная запись без конфликтов.

## 0.7.0

- Добавлен простой Item/Block Builder с автоматическим ID, живой иконкой-образцом и читаемой генерацией `startup_scripts`.
- Vanilla, Addon и Generic Recipe Editors автоматически создают уникальное понятное имя рецепта из результата и типа; ручной ID оставлен как опция.
- Connector 0.4.0 содержит `kubevs:debug_item`, `kubevs:debug_block`, игровые модели, локализацию и два контрольных крафта.

## 0.6.2

- Иконки предметов автоматически подбираются после ручного ввода полного игрового ID.
- Добавлены debounce, защита от устаревших ответов и корректная очистка иконки при изменении ID.
- Поведение работает в Vanilla, Addon и Generic Recipe Editors.

## 0.6.1

- Исправлено дублирование `kubejs/kubejs`, когда пользователь открывает непосредственно папку `kubejs` или `server_scripts`.
- Connector 0.3.1 передаёт расширению канонические пути экземпляра Minecraft и KubeJS-проекта.
- После локального подключения KubeVS автоматически создаёт стандартные папки и открывает правильный KubeJS workspace.
- Существующие скрипты не перезаписываются; стартовые `main.js` создаются только при отсутствии.

## 0.6.0

- Добавлено безопасное удаление и восстановление рецептов через управляемый `event.remove`, включая выбор из live-каталога и Save and Reload.
- Реализован Craft Graph по реальным рецептам текущей сборки: альтернативные пути, циклы, ограничения глубины, шансы и побочные продукты.
- Добавлен калькулятор базовых предметов, жидкостей, времени и энергии с пересчётом количества результата.
- Дерево получило русскоязычный трёхпанельный интерфейс, игровые иконки, сворачивание ветвей и инспектор узла.
- Connector 0.3.0 предоставляет постраничный snapshot рецептов и пакетную загрузку иконок; последний snapshot доступен в Offline Mode.

## 0.5.1

- Рецепты Vanilla, Create, Oritech, Farmer’s Delight и Generic теперь сохраняются автоматически в настроенную папку `kubevs-generated` без диалога выбора файла.
- После выбора предмета редактор показывает его настоящую пиксельную текстуру рядом с ID.
- Connector 0.2.1 добавляет безопасную выдачу иконок предметов из ресурсов Vanilla и модовых JAR с поддержкой item-model.

## 0.5.0

- Переработаны Project, Recipes, LootJS, Registries и Connection Views: понятные действия, русские подписи, описания и состояния вместо технических счётчиков.
- Добавлены предоставленные пользователем пиксельные 1-bit иконки с отдельными вариантами для светлой и тёмной темы VS Code.
- Добавлен общий поиск игровых ID по отображаемому имени, `namespace:id` и translation key.
- Vanilla, модовые, Generic и LootJS-редакторы получили нативные picker-кнопки для предметов, тегов, блоков и сущностей.
- Автодополнение игровых ID работает внутри строк JavaScript, TypeScript и JSON, включая поиск по русскому имени.
- Connector 0.2.0 передаёт отображаемые имена предметов, блоков и сущностей; для остальных реестров формируется читаемое имя из ID.
- Offline Mode индексирует ID из открытого проекта и предоставляет встроенные Vanilla-подсказки.

## 0.4.0

- Добавлен полноценный русскоязычный LootJS Builder для таблиц добычи, блоков и сущностей.
- Реализовано вложенное дерево условий AND / OR / NOT, случайный шанс, инструмент, убийство игроком, взрыв и пользовательский JSON.
- Добавлены действия добавления, удаления и замены добычи, а также выдачи опыта.
- Предпросмотр генерирует читаемый `LootJS.modifiers(...)`; сохранение использует native diff и защищено от конкурентной перезаписи.
- Webview ограничивает размер и глубину модели, проверяет уникальность узлов и отклоняет опасные JSON-поля.

## 0.3.0

- Добавлен русскоязычный редактор рецептов Create, Oritech и Farmer’s Delight.
- Реализована timeline для Create Sequenced Assembly: добавление, удаление и перестановка шагов.
- Поддержаны несколько входов и результатов, количество, шанс/вес, время, нагрев и инструменты.
- Генерация использует читаемый `event.custom(...)`, проверку ID и безопасный native diff.
- Основные команды и представления расширения переведены на русский язык.

## 0.2.1

- Simplified Connector authorization with trusted-workspace token discovery, native file selection,
  secure paste fallback, and endpoint-scoped SecretStorage.
- Added automatic migration from legacy profiles, rejected-token recovery, and
  `KubeVS: Change Connector Token`.
- Connector 0.1.1 adds the permission-gated `/kubevs auth` control surface with in-game copy and
  confirmed live token rotation.
- Token rotation now disconnects authenticated sessions and requires no server restart.

## 0.2.0

- Added the schema-driven Generic Recipe Editor, workspace schema watcher, typed custom fields,
  dynamic raw recipes, strict schema validation, and shared TOCTOU-safe generated-file writes.
- Added commands to create generic recipes and workspace recipe-schema templates.
- Hardened canonical preview revision handling against stale asynchronous responses.

## 0.1.0

- Added the Stage 0 audit and Stage 1 Extension Foundation.
- Added strict monorepo tooling, protocol and parser packages.
- Added the authenticated experimental WebSocket Connector and live snapshots.
- Added KubeJS completion, hover, highlighting, symbols, diagnostics, and Code Actions.
- Added generic registry/tag queries, registry-aware recipe JSON, editor insertion commands, and
  live TypeScript declaration generation with diff confirmation.
- Added normalized vanilla shaped, shapeless and cooking recipe imports, readable KubeJS
  generation, and lossless fallback for unknown custom recipe schemas.
- Verified the Connector and server reload against a real NeoForge 1.21.1 dedicated server.
