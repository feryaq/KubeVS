# Интеграция Recipe Viewer (JEI / EMI)

KubeVS использует единый формат отображения рецептов и не привязывает интерфейс к API конкретного
просмотрщика. Обычный `RecipeManager` остаётся базовым источником, а JEI или EMI дополняют его
категориями, рабочими станциями, катализаторами и пригодными для визуализации слотами.

## Контракт display

Метод `recipeViewers.displays` принимает `offset`, `limit` и `compact`. Ответ:

```json
{
  "entries": [
    {
      "recipeId": "create:brass_mixing",
      "recipeType": "create:mixing",
      "categoryId": "create:mixing",
      "categoryName": "Смешивание",
      "provider": "emi",
      "inputs": [
        { "kind": "item", "id": "minecraft:copper_ingot", "count": 1, "chance": 1, "role": "input" }
      ],
      "outputs": [
        { "kind": "item", "id": "create:brass_ingot", "count": 1, "chance": 1, "role": "output" }
      ],
      "catalysts": [
        { "kind": "item", "id": "create:blaze_burner", "count": 1, "chance": 1, "role": "catalyst" }
      ],
      "workstations": [
        {
          "kind": "item",
          "id": "create:mechanical_mixer",
          "count": 1,
          "chance": 1,
          "role": "render-only"
        },
        { "kind": "item", "id": "create:basin", "count": 1, "chance": 1, "role": "render-only" }
      ],
      "duration": 100,
      "energy": 0,
      "width": 177,
      "height": 85
    }
  ],
  "offset": 0,
  "total": 1,
  "hasMore": false
}
```

`kind` принимает `item`, `tag` или `fluid`. `chance` передаётся в диапазоне от 0 до 1. Поле `name`
опционально и содержит локализованное игровое имя. Размер display нужен для сохранения пропорций
слотов, но не используется как растровый скриншот JEI/EMI.

## Совместимость и Offline Mode

- Если capability `recipeViewer`/`recipeDisplays` отсутствует, Craft Graph использует
  `recipes.snapshot`.
- Старые Connector также определяются по интеграциям `jei` или `emi`, но ошибка неизвестного метода
  безопасно переводит интерфейс на обычный snapshot.
- Валидные display сохраняются в `.kubevs/cache/recipe-viewer.json`.
- При отсутствии Minecraft кэш обогащает сохранённый recipe snapshot.
- Для одинаковой пары `recipeId + categoryId` приоритет источников: EMI, затем JEI, затем Minecraft.
- Некорректные ID, размеры страниц и чрезмерные массивы отбрасываются на границе расширения.

## Отображение и производительность

Craft Graph показывает каноническое русское название операции, источник визуала, рабочие станции и
катализаторы. Станции не считаются расходниками. Если просмотрщик не передал станции, KubeVS
подставляет консервативные встроенные соответствия для Vanilla, Create и Farmer’s Delight.

Текстуры предметов не загружаются всем каталогом. Webview наблюдает только элементы около viewport,
собирает запросы пачками до 128 ID и повторно не запрашивает уже полученную текстуру. Сам Connector
и `RegistryCatalog` дополнительно ограничивают LRU-кэш.

## Канонические названия

Общий словарь находится в `recipeViewerCore.ts`. Например:

- `create:mixing` — «Смешивание»;
- `create:pressing` — «Прессование»;
- `create:sequenced_assembly` — «Последовательная сборка»;
- `minecraft:crafting_shapeless` — «Бесформенный крафт».

Незнакомые типы преобразуются из resource ID в читаемое название без потери исходного ID в
инспекторе.
