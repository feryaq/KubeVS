# Отчёт по этапу 4 — текущий вертикальный сценарий

## Сделано

- Нормализованная типизированная модель Vanilla recipes.
- Импорт shaped, shapeless и cooking JSON.
- Lossless fallback для неизвестных пользовательских и модовых схем.
- Читаемая генерация KubeJS.
- Визуальный Vanilla Recipe Editor для shaped, shapeless, smelting, blasting, smoking и campfire
  recipes.
- Live preview, item/tag ingredients, result count и recipe ID.
- Native Save Dialog и обязательный diff перед перезаписью.
- Импорт реального recipe JSON из Connector сразу в KubeJS.

## Проверено

- Unit-тесты модели, импорта, генератора и неизвестных схем.
- Строгая TypeScript-сборка, ESLint и Prettier.
- Extension Host открывает Recipe Editor.
- UI detector не обнаружил механических проблем.

## Ещё не завершено

- Импорт существующего локального JavaScript обратно в визуальную модель.
- Custom Editor для повторного открытия сохранённой модели.
- Специализированные Create, Oritech и Farmer's Delight редакторы.
- Пользовательские JSON schemas.
