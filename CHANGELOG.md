# Changelog

## 0.10.1 / Connector 0.7.2

- Replaced automatic full JEI layout indexing with on-demand rendering for visible Craft Graph nodes.
- Added the client-side `/kvs bake` command for explicit incremental full-index generation.
- Avoided downloading the Minecraft fallback display catalog twice when opening Craft Graph.
- Added fail-fast protection for non-advancing recipe snapshot pagination.
- Preserved cached/offline data while JEI is still initializing.

## Connector 0.7.1

- Fixed JEI 19.42 startup log flooding caused by creating recipe layouts before client configs.
- Deferred indexing until the next client tick and limited layout creation to 32 recipes per tick.
- Added safe retry while JEI is not ready, cancellation on runtime reload and incremental snapshot
  publication for large modpacks.
- Updated the compile-only JEI API to 19.42.0.385.

## 0.10.0 / Connector 0.7.0

- Rebuilt Craft Graph as a movable, pannable and zoomable node canvas with persisted positions.
- Added lazy images rendered from JEI's real recipe layout, with structured fallback on servers.
- Fixed tag ingredients being expanded into every tag member in resource totals and graph nodes.
- Added release minification/obfuscation and author metadata for F_ery_a228 (`@F_ery_a`).
- Verified remote workspace write, revision round-trip and two-client file-lock handoff against a
  live dedicated server.

## 0.9.0

- Добавлен единый мост Recipe Viewer с необязательными клиентскими адаптерами JEI и EMI и
  безопасным fallback на Minecraft RecipeManager для dedicated server.
- Craft Graph показывает канонические названия операций, станки, катализаторы, жидкости и
  богатые игровые иконки; данные и иконки загружаются постранично и лениво, Offline Mode сохранён.
- Recipe Builder поддерживает жидкостные входы и результаты Create Mixing/Compacting в mB,
  поиск по реестру жидкостей, автоматические иконки и строгую проверку формата NeoForge.
- Connector 0.6.1 предоставляет capability-gated методы `recipeViewers.*`; JEI/EMI API остаются
  compile-only и не встраиваются в итоговый JAR.
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
