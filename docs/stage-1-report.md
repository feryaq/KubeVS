# Stage 1 report

## Сделано

- Проведён и зафиксирован аудит исходного NeoForge MDK.
- Создан pnpm/Gradle monorepo со strict TypeScript, ESLint, Prettier и тестами.
- Реализованы KubeVS Extension, Activity Bar, пять Tree Views, Dashboard, Status Bar и Output
  Channels.
- Реализован Offline Mode и рабочая вертикаль от обнаружения KubeJS-файлов до Problems и открытия
  файла по клику.
- Созданы protocol package, runtime guards и явно обозначенный mock Connector.
- MDK example заменён dedicated-server-safe каркасом KubeVS Connector.

## Рабочие сценарии

- Открытие KubeJS workspace → индексирование трёх script roots → Project View → открытие файла.
- Изменение открытого KubeJS-скрипта → debounce → статический анализ → Problems.
- Dashboard → refresh/validate/mock connect через проверяемый message bridge.
- Работа интерфейса без Minecraft в Offline Mode.

## Архитектурные решения

- Extension Host, webview, pure TypeScript packages и Java Connector разделены.
- Webview не имеет Node.js API, использует CSP/nonce и allow-list команд.
- Mock не выдаётся за live connection.
- Live-функции не документируются как готовые.

## Проверено

- `pnpm lint`
- `pnpm typecheck`
- unit tests protocol/parser
- Extension integration tests на локальном VS Code: 2 passed
- `pnpm build`
- `pnpm format:check`
- `gradlew test build`: success (`Connector:test` пока `NO-SOURCE`)

## Известные ограничения

- Реальный Connector transport, auth, permissions и snapshots относятся к Этапу 2.
- `runClient` и `runServer` не запускались: Foundation не содержит live transport; для server run
  также не было принято Minecraft EULA.
- Встроенная диагностика Foundation намеренно базовая и не является полноценным KubeJS parser.
- VS Code integration runner печатает upstream Node warning `DEP0190`.

## Незавершённые функции

Этапы 2–9: live Connector, language support, Recipe Core и integrations, LootJS, Item/Block
builders, Registry Browser, Craft Graph, Resource Calculator, polishing/packaging.

## Следующий этап

Этап 2: аутентифицированный localhost transport, protocol negotiation, capabilities, permissions,
registries/recipes/logs/reload и реальная Connection View.
