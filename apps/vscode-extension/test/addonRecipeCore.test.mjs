import assert from 'node:assert/strict';
import test from 'node:test';
import { generateAddonRecipe } from '../dist/addonRecipeCore.mjs';

const base = {
  recipeId: 'kubevs:test',
  ingredients: ['minecraft:iron_ingot'],
  fluidInputs: [],
  outputs: [{ item: 'create:iron_sheet', count: 1, chance: 1 }],
  fluidOutputs: [],
  processingTime: 100,
  experience: 0,
  heat: 'none',
  loops: 5,
  transitionalItem: 'create:incomplete_precision_mechanism',
  tool: '#minecraft:axes',
  sequence: [],
};

test('генерирует читаемый рецепт Create', () => {
  const code = generateAddonRecipe({ ...base, type: 'create:pressing' });

  assert.match(code, /"type": "create:pressing"/);
  assert.match(code, /\.id\("kubevs:test"\)/);
  assert.doesNotMatch(code, /"count": 1/);
});

test('генерирует Sequenced Assembly с упорядоченными шагами', () => {
  const code = generateAddonRecipe({
    ...base,
    type: 'create:sequenced_assembly',
    outputs: [{ item: 'create:precision_mechanism', count: 1, chance: 120 }],
    sequence: [
      { type: 'create:deploying', ingredient: 'create:cogwheel' },
      { type: 'create:pressing', ingredient: '' },
    ],
  });

  assert.match(code, /"type": "create:sequenced_assembly"/);
  assert.match(code, /"loops": 5/);
  assert.ok(code.indexOf('create:deploying') < code.indexOf('create:pressing'));
});

test('поддерживает Oritech и Farmer’s Delight', () => {
  const oritech = generateAddonRecipe({ ...base, type: 'oritech:assembler' });
  const cooking = generateAddonRecipe({
    ...base,
    type: 'farmersdelight:cooking',
    outputs: [{ item: 'farmersdelight:beef_stew', count: 1, chance: 1 }],
    experience: 1,
  });

  assert.match(oritech, /"time": 100/);
  assert.match(cooking, /"recipe_book_tab": "meals"/);
  assert.match(cooking, /"cookingtime": 100/);
});

test('генерирует жидкостные входы и результаты Create в миллибакетах', () => {
  const code = generateAddonRecipe({
    ...base,
    type: 'create:mixing',
    ingredients: ['minecraft:sugar', 'minecraft:cocoa_beans'],
    fluidInputs: [{ fluid: '#c:milk', amount: 250 }],
    outputs: [],
    fluidOutputs: [{ fluid: 'create:chocolate', amount: 250 }],
    heat: 'heated',
  });

  assert.match(code, /"type": "neoforge:tag"/);
  assert.match(code, /"tag": "c:milk"/);
  assert.match(code, /"amount": 250/);
  assert.match(code, /"id": "create:chocolate"/);
  assert.match(code, /"heat_requirement": "heated"/);
});

test('поддерживает конкретную жидкость и отклоняет жидкость у неподходящей машины', () => {
  const compacting = generateAddonRecipe({
    ...base,
    type: 'create:compacting',
    ingredients: [],
    fluidInputs: [{ fluid: 'create:chocolate', amount: 250 }],
    outputs: [{ item: 'create:bar_of_chocolate', count: 1, chance: 1 }],
  });

  assert.match(compacting, /"type": "neoforge:single"/);
  assert.match(compacting, /"fluid": "create:chocolate"/);
  assert.throws(
    () =>
      generateAddonRecipe({
        ...base,
        type: 'create:pressing',
        fluidInputs: [{ fluid: 'minecraft:water', amount: 1000 }],
      }),
    /Жидкости.*смешивания.*бассейне/,
  );
});

test('проверяет объём и запрещает тег в жидкостном результате', () => {
  assert.throws(
    () =>
      generateAddonRecipe({
        ...base,
        type: 'create:mixing',
        fluidInputs: [{ fluid: 'minecraft:water', amount: 0 }],
      }),
    /Объём жидкостного входа/,
  );
  assert.throws(
    () =>
      generateAddonRecipe({
        ...base,
        type: 'create:mixing',
        fluidOutputs: [{ fluid: '#c:milk', amount: 250 }],
      }),
    /конкретную жидкость/,
  );
});

test('отклоняет некорректные ID и пустую последовательность', () => {
  assert.throws(
    () => generateAddonRecipe({ ...base, type: 'create:pressing', recipeId: 'bad id' }),
    /namespace:path/,
  );
  assert.throws(
    () => generateAddonRecipe({ ...base, type: 'create:sequenced_assembly' }),
    /хотя бы один шаг/,
  );
});

test('не допускает произвольные типы и недопустимую форму машины', () => {
  assert.throws(
    () => generateAddonRecipe({ ...base, type: 'evil:machine' }),
    /повреждённую или неподдерживаемую/,
  );
  assert.throws(
    () =>
      generateAddonRecipe({
        ...base,
        type: 'create:pressing',
        ingredients: ['minecraft:iron_ingot', 'minecraft:stick'],
      }),
    /ровно один входной/,
  );
  assert.throws(
    () =>
      generateAddonRecipe({
        ...base,
        type: 'farmersdelight:cooking',
        outputs: [
          { item: 'farmersdelight:beef_stew', count: 1, chance: 1 },
          { item: 'minecraft:bowl', count: 1, chance: 1 },
        ],
      }),
    /ровно один результат/,
  );
});
