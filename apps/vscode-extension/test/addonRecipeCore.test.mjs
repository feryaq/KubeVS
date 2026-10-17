import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
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

// Reference from Create mc1.21.1/dev, src/generated/resources/data/create/recipe/
// mechanical_crafting/crushing_wheel.json (MIT), retrieved 2026-10-17.
const wheel = JSON.parse(
  readFileSync(new URL('./fixtures/create-crushing-wheel-1.21.1.json', import.meta.url), 'utf8'),
);
const mechanicalDraft = {
  ...base,
  type: 'create:mechanical_crafting',
  ingredients: [],
  outputs: [{ item: 'create:crushing_wheel', count: 2, chance: 1 }],
  mechanical: {
    pattern: wheel.pattern,
    key: { A: 'create:andesite_alloy', P: '#minecraft:planks', S: '#c:stones' },
    acceptMirrored: false,
  },
};

function executeRecipe(draft) {
  let recipe, id;
  runInNewContext(generateAddonRecipe(draft), {
    ServerEvents: {
      recipes: (callback) =>
        callback({
          custom: (value) => {
            recipe = value;
            return {
              id: (value) => {
                id = value;
              },
            };
          },
        }),
    },
  });
  return { recipe: JSON.parse(JSON.stringify(recipe)), id };
}

test('mechanical crafting matches the actual Create 1.21.1 crushing wheel JSON', () => {
  const { recipe, id } = executeRecipe(mechanicalDraft);
  const { category, show_notification, ...expected } = wheel;
  assert.deepEqual(recipe, expected);
  assert.equal(id, 'kubevs:test');
  assert.equal(recipe.pattern.flatMap((row) => [...row]).filter((c) => c === 'A').length, 16);
});

test('mechanical crafting supports 9×9 and an explicit mirrored recipe', () => {
  const { recipe } = executeRecipe({
    ...mechanicalDraft,
    mechanical: {
      ...mechanicalDraft.mechanical,
      pattern: Array(9).fill('A'.repeat(9)),
      acceptMirrored: true,
    },
  });
  assert.equal(recipe.pattern.length, 9);
  assert.equal(recipe.pattern[0].length, 9);
  assert.equal(recipe.accept_mirrored, true);
  assert.deepEqual(recipe.key, { A: { item: 'create:andesite_alloy' } });
  assert.equal(recipe.ingredients, undefined);
  assert.equal(recipe.results, undefined);
});

test('mechanical crafting rejects incomplete, empty and malformed patterns', () => {
  for (const mechanical of [
    undefined,
    { ...mechanicalDraft.mechanical, pattern: [] },
    { ...mechanicalDraft.mechanical, pattern: ['   '] },
    { ...mechanicalDraft.mechanical, pattern: ['AA', 'A'] },
    { ...mechanicalDraft.mechanical, pattern: ['AAAAAAAAAA'] },
    { ...mechanicalDraft.mechanical, pattern: ['#'] },
    { ...mechanicalDraft.mechanical, pattern: ['X'] },
    { ...mechanicalDraft.mechanical, acceptMirrored: 'false' },
  ]) {
    assert.throws(() => generateAddonRecipe({ ...mechanicalDraft, mechanical }));
  }
});

test('mechanical crafting rejects fluid, probabilistic and multiple outputs', () => {
  for (const patch of [
    { fluidInputs: [{ fluid: 'minecraft:water', amount: 1000 }] },
    { fluidOutputs: [{ fluid: 'minecraft:water', amount: 1000 }] },
    { outputs: [] },
    { outputs: [...mechanicalDraft.outputs, ...mechanicalDraft.outputs] },
    { outputs: [{ ...mechanicalDraft.outputs[0], chance: 0.5 }] },
  ])
    assert.throws(() => generateAddonRecipe({ ...mechanicalDraft, ...patch }));
});

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
