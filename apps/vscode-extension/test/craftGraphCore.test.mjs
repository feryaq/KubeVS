import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCraftTree,
  calculateCraftTotals,
  canonicalRecipeLabel,
  enrichCraftRecipes,
  mergeRecipeViewerDisplays,
  normalizeRecipe,
  parseRecipeViewerDisplay,
  parseRecipeViewerPage,
  recipeViewerCapability,
} from '../dist/craftGraphCore.mjs';

test('нормализует shaped-рецепт с фактическим количеством ячеек', () => {
  const recipe = normalizeRecipe({
    id: 'minecraft:sticks',
    recipeType: 'minecraft:crafting_shaped',
    json: {
      pattern: ['A', 'A'],
      key: { A: { item: 'minecraft:planks' } },
      result: { id: 'minecraft:stick', count: 4 },
    },
  });
  assert.equal(recipe.inputs[0].count, 2);
  assert.equal(recipe.outputs[0].count, 4);
});

test('строит дерево, считает базовые ресурсы и поддерживает альтернативы', () => {
  const recipes = [
    {
      id: 'test:stick_from_planks',
      recipeType: 'minecraft:crafting_shaped',
      inputs: [{ kind: 'item', id: 'minecraft:planks', count: 2, chance: 1 }],
      outputs: [{ kind: 'item', id: 'minecraft:stick', count: 4, chance: 1 }],
      duration: 10,
      energy: 5,
    },
    {
      id: 'test:stick_from_bamboo',
      recipeType: 'minecraft:crafting_shapeless',
      inputs: [{ kind: 'item', id: 'minecraft:bamboo', count: 2, chance: 1 }],
      outputs: [{ kind: 'item', id: 'minecraft:stick', count: 1, chance: 1 }],
      duration: 0,
      energy: 0,
    },
  ];
  const tree = buildCraftTree(recipes, 'minecraft:stick', 8, {
    'minecraft:stick': 'test:stick_from_planks',
  });
  assert.equal(tree.alternatives, 2);
  assert.equal(tree.batches, 2);
  assert.deepEqual(calculateCraftTotals(tree).items, { 'minecraft:planks': 4 });
});

test('не складывает варианты одного ингредиента и не считает инструмент расходником', () => {
  const recipe = normalizeRecipe({
    id: 'test:cutting',
    recipeType: 'test:cutting',
    json: {
      ingredients: [[{ item: 'minecraft:oak_planks' }, { item: 'minecraft:spruce_planks' }]],
      tool: { item: 'minecraft:iron_axe' },
      result: { id: 'minecraft:stick', count: 2 },
    },
  });
  assert.deepEqual(
    recipe.inputs.map(({ id, count }) => ({ id, count })),
    [{ id: 'minecraft:oak_planks', count: 1 }],
  );
});

test('нормализует веса результатов и учитывает шанс побочного продукта', () => {
  const recipe = normalizeRecipe({
    id: 'test:weighted_crushing',
    recipeType: 'create:crushing',
    json: {
      ingredients: [{ item: 'minecraft:stone' }],
      results: [
        { id: 'minecraft:cobblestone', count: 1, chance: 75 },
        { id: 'minecraft:flint', count: 2, chance: 25 },
      ],
    },
  });
  assert.equal(recipe.outputs[0].chance, 0.75);
  assert.equal(recipe.outputs[1].chance, 0.25);
  const tree = buildCraftTree([recipe], 'minecraft:cobblestone', 3);
  assert.equal(tree.batches, 4);
  assert.equal(tree.byproducts[0].id, 'minecraft:flint');
  assert.equal(tree.byproducts[0].count, 2);
});

test('безопасно разбирает богатый display JEI/EMI со станциями и жидкостями', () => {
  const display = parseRecipeViewerDisplay({
    recipeId: 'create:mix_brass',
    recipeType: 'create:mixing',
    categoryId: 'create:mixing',
    provider: 'emi',
    inputs: [
      { item: 'minecraft:copper_ingot', count: 1 },
      { fluid: 'minecraft:lava', amount: 250 },
    ],
    outputs: [{ item: 'create:brass_ingot' }],
    catalysts: [{ item: 'create:blaze_burner', name: 'Горелка' }],
    workstations: [{ item: 'create:mechanical_mixer' }, { item: 'create:basin' }],
    duration: 100,
  });
  assert.equal(display.categoryName, 'Смешивание');
  assert.equal(display.inputs[1].kind, 'fluid');
  assert.deepEqual(
    display.workstations.map((entry) => entry.id),
    ['create:mechanical_mixer', 'create:basin'],
  );
  assert.equal(display.catalysts[0].role, 'catalyst');
});

test('отбрасывает повреждённую страницу и предпочитает EMI при дедупликации', () => {
  assert.equal(
    parseRecipeViewerPage({ entries: [], offset: -1, total: 0, hasMore: false }),
    undefined,
  );
  const jei = parseRecipeViewerDisplay({
    id: 'test:plate',
    type: 'create:pressing',
    category: 'create:pressing',
    source: 'jei',
    inputs: ['minecraft:iron_ingot'],
    results: ['create:iron_sheet'],
  });
  const emi = { ...jei, provider: 'emi' };
  assert.equal(mergeRecipeViewerDisplays([jei, emi])[0].provider, 'emi');
});

test('распознаёт capability старого и нового Connector и канонические названия', () => {
  assert.equal(recipeViewerCapability({ recipeViewer: true }), true);
  assert.equal(recipeViewerCapability({ integrations: ['kubejs', 'jei'] }), true);
  assert.equal(recipeViewerCapability({ integrations: ['kubejs'] }), false);
  assert.equal(canonicalRecipeLabel('create:pressing'), 'Прессование');
});

test('не разворачивает тег в полный список вариантов JEI', () => {
  const snapshot = normalizeRecipe({
    id: 'minecraft:planks',
    recipeType: 'minecraft:crafting_shapeless',
    json: {
      ingredients: [{ tag: 'minecraft:logs' }],
      result: { id: 'minecraft:oak_planks', count: 4 },
    },
  });
  const viewer = {
    id: 'minecraft:planks',
    recipeType: 'minecraft:crafting_shapeless',
    label: 'Крафт',
    categoryId: 'minecraft:crafting',
    provider: 'jei',
    inputs: [
      { kind: 'item', id: 'minecraft:oak_log', count: 1, chance: 1 },
      { kind: 'item', id: 'minecraft:spruce_log', count: 1, chance: 1 },
    ],
    outputs: [{ kind: 'item', id: 'minecraft:oak_planks', count: 4, chance: 1 }],
    duration: 0,
    energy: 0,
  };
  const [merged] = enrichCraftRecipes([snapshot], [viewer]);
  assert.deepEqual(merged.inputs, [{ kind: 'tag', id: 'minecraft:logs', count: 1, chance: 1 }]);
  assert.equal(merged.provider, 'jei');
});
