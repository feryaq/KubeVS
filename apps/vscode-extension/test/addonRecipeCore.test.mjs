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

test('generates a readable Create recipe', () => {
  const code = generateAddonRecipe({ ...base, type: 'create:pressing' });

  assert.match(code, /"type": "create:pressing"/);
  assert.match(code, /\.id\("kubevs:test"\)/);
  assert.doesNotMatch(code, /"count": 1/);
});

test('generates Sequenced Assembly with ordered steps', () => {
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

test('supports Oritech and Farmer’s Delight', () => {
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

test('generates Create fluid inputs and outputs in millibuckets', () => {
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

test('supports a concrete fluid and rejects fluids for an incompatible machine', () => {
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
    /fluids.*mixing.*compacting/,
  );
});

test('validates amounts and rejects tags in fluid outputs', () => {
  assert.throws(
    () =>
      generateAddonRecipe({
        ...base,
        type: 'create:mixing',
        fluidInputs: [{ fluid: 'minecraft:water', amount: 0 }],
      }),
    /Fluid input amount/,
  );
  assert.throws(
    () =>
      generateAddonRecipe({
        ...base,
        type: 'create:mixing',
        fluidOutputs: [{ fluid: '#c:milk', amount: 250 }],
      }),
    /concrete fluid/,
  );
});

test('rejects invalid IDs and an empty sequence', () => {
  assert.throws(
    () => generateAddonRecipe({ ...base, type: 'create:pressing', recipeId: 'bad id' }),
    /namespace:path/,
  );
  assert.throws(
    () => generateAddonRecipe({ ...base, type: 'create:sequenced_assembly' }),
    /at least one assembly step/,
  );
});

test('rejects arbitrary types and invalid machine shapes', () => {
  assert.throws(
    () => generateAddonRecipe({ ...base, type: 'evil:machine' }),
    /invalid or unsupported/,
  );
  assert.throws(
    () =>
      generateAddonRecipe({
        ...base,
        type: 'create:pressing',
        ingredients: ['minecraft:iron_ingot', 'minecraft:stick'],
      }),
    /exactly one input/,
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
    /exactly one output/,
  );
});
