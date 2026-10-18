import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCraftTree,
  calculateCraftTotals,
  canonicalRecipeLabel,
  defaultWorkstations,
  normalizeRecipe,
} from '../dist/craftGraphCore.mjs';

test('normalizes a shaped recipe using the actual slot count', () => {
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

test('builds a tree, totals base resources, and supports alternatives', () => {
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

test('does not add ingredient alternatives together or count tools as consumables', () => {
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

test('normalizes output weights and accounts for byproduct chance', () => {
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

test('keeps canonical names and machines without an external recipe viewer', () => {
  assert.equal(canonicalRecipeLabel('create:pressing'), 'Pressing');
  assert.deepEqual(defaultWorkstations('create:mixing'), [
    'create:mechanical_mixer',
    'create:basin',
  ]);
});

test('normalizes GTCEu capability maps with catalysts and chanced byproducts', () => {
  const recipe = normalizeRecipe({
    id: 'kubevs:gt_assembler',
    recipeType: 'gtceu:assembler',
    json: {
      duration: 200,
      inputs: {
        item: [
          {
            content: {
              type: 'gtceu:sized',
              count: 2,
              ingredient: { item: 'minecraft:iron_ingot' },
            },
            chance: 1,
          },
          {
            content: { type: 'gtceu:sized', count: 1, ingredient: { item: 'minecraft:bucket' } },
            chance: 0,
          },
        ],
        fluid: [{ content: { amount: 250, fluid: 'minecraft:water' }, chance: 1 }],
      },
      outputs: {
        item: [
          {
            content: { type: 'gtceu:sized', count: 1, ingredient: { item: 'minecraft:diamond' } },
            chance: 1,
          },
          {
            content: { type: 'gtceu:sized', count: 1, ingredient: { item: 'minecraft:gravel' } },
            chance: 1250,
            maxChance: 10000,
          },
        ],
      },
      tickInputs: { eu: [{ content: { voltage: 30, amperage: 1 }, chance: 1 }] },
    },
  });
  assert.deepEqual(
    recipe.inputs.map((x) => [x.id, x.count]),
    [
      ['minecraft:iron_ingot', 2],
      ['minecraft:water', 250],
    ],
  );
  assert.equal(recipe.catalysts[0].id, 'minecraft:bucket');
  assert.equal(recipe.outputs[1].chance, 0.125);
  assert.equal(recipe.energy, 6000);
});
