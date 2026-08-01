# Удаление и восстановление рецептов

Команда **KubeVS: Удалить рецепт** позволяет найти рецепт по ID или типу в подключённом Minecraft.
В Offline Mode полный ID можно ввести вручную.

KubeVS не удаляет исходный JSON из модов. Вместо этого он поддерживает безопасный generated-файл:

```text
kubejs/server_scripts/kubevs/zz_kubevs_removed_recipes.js
```

В нём создаются читаемые правила:

```js
ServerEvents.recipes((event) => {
  event.remove({ id: 'minecraft:diamond_pickaxe' });
});
```

Единственный источник состояния — читаемый generated-файл `zz_kubevs_removed_recipes.js`.
KubeVS управляет им сам и обновляет его без второго диалога сохранения. Удаление всегда
генерируется как `event.remove({ id: "namespace:recipe_id" })`: результат рецепта не используется
как критерий. С подключённым Connector после изменения автоматически выполняется Save and Reload.

Команда **KubeVS: Восстановить удалённый рецепт** убирает выбранное правило `event.remove` и
перезагружает данные.
