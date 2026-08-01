# Отчёт по этапу 5 — редакторы рецептов модов

## Сделано

- Единый редактор основных рецептов Create, Oritech и Farmer’s Delight.
- Русский интерфейс, состояния ошибок и команды.
- Timeline Create Sequenced Assembly с изменяемым порядком шагов.
- Несколько входов и результатов, количество, шанс/вес, время, нагрев и инструмент.
- Строгая проверка resource location и числовых параметров.
- Читаемая генерация KubeJS и безопасный diff перед перезаписью.

## Проверено

- Unit-тесты обычного Create-рецепта, Sequenced Assembly, Oritech и Farmer’s Delight.
- Проверка некорректных ID и пустой последовательности.
- Extension Host открывает новый webview через зарегистрированную команду.
- TypeScript, ESLint, Prettier и production bundle проверяются общим `pnpm check`.

## Следующие задачи

- Импорт существующего JavaScript обратно в визуальную модель.
- Fluid ingredients/results и энергия для расширенных машин.
- Дополнительные операции Sequenced Assembly, включая filling/spouting.
- Проверка рецептов на реальных установленных версиях Create, Oritech и Farmer’s Delight.
- LootJS Builder с деревом AND/OR/NOT.
