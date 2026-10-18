import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCraftTree,
  calculateCraftTotals,
  canonicalRecipeLabel,
  defaultWorkstations,
  normalizeRecipe,
  fetchRecipeSnapshot,
  packCraftTree,
} from '../dist/craftGraphCore.mjs';

test('compact graph preserves every tree field and shared recipe metadata without loss', () => {
  const stack = (id) => ({ kind: 'item', id, count: 1, chance: 1 });
  const recipes = [
    {
      id: 'pack:final',
      recipeType: 'pack:assembling',
      inputs: Array.from({ length: 12 }, () => stack('pack:part')),
      outputs: [stack('pack:final')],
      duration: 20,
      energy: 40,
    },
    {
      id: 'pack:part',
      recipeType: 'pack:pressing',
      categoryId: 'pack:parts',
      catalysts: [stack('pack:mold')],
      workstations: [stack('pack:press')],
      inputs: [stack('pack:raw')],
      outputs: [stack('pack:part')],
      duration: 10,
      energy: 20,
    },
  ];
  const tree = buildCraftTree(recipes, 'pack:final', 2);
  const packed = packCraftTree(tree);
  const decode = (index) => {
    const node = Object.fromEntries(packed.columns.map((key, i) => [key, packed.nodes[index][i]]));
    if (node.recipeId === null) {
      delete node.recipeId;
      node.catalysts = [];
      node.workstations = [];
    } else Object.assign(node, packed.recipes[node.recipeId]);
    node.children = node.children.map(decode);
    return node;
  };
  assert.deepEqual(decode(0), tree);
  assert.ok(JSON.stringify(packed).length < JSON.stringify(tree).length * 0.65);
});

test('loads all 36028 recipes including a target beyond the old 25000 cap', async () => {
  const fixture = Array.from({ length: 36028 }, (_, i) => ({
    id: `pack:r_${i}`,
    recipeType: 'minecraft:crafting_shapeless',
    json: { ingredients: [{ item: 'minecraft:stone' }], result: { id: `pack:item_${i}` } },
  }));
  let pages = 0;
  const entries = await fetchRecipeSnapshot(async (offset, limit) => {
    pages++;
    return {
      entries: fixture.slice(offset, offset + limit),
      offset,
      total: fixture.length,
      hasMore: offset + limit < fixture.length,
    };
  });
  assert.equal(entries.length, 36028);
  assert.equal(pages, 73);
  const tree = buildCraftTree(entries.map(normalizeRecipe).filter(Boolean), 'pack:item_36027', 2);
  assert.equal(tree.recipeId, 'pack:r_36027');
  assert.equal(calculateCraftTotals(tree).items['minecraft:stone'], 2);
});

test('rejects incomplete, duplicate and changing catalogs instead of returning a partial graph', async () => {
  const entry = { id: 'pack:r', recipeType: 'pack:recipe', json: {} };
  for (const page of [
    { entries: [], offset: 0, total: 1, hasMore: true },
    { entries: [entry], offset: 0, total: 2, hasMore: false },
    { entries: [entry, entry], offset: 0, total: 2, hasMore: false },
    { entries: [], offset: 1, total: 0, hasMore: false },
    { entries: [], offset: 0, total: 250001, hasMore: true },
  ])
    await assert.rejects(fetchRecipeSnapshot(async () => page));
  await assert.rejects(
    fetchRecipeSnapshot(async (offset) => ({
      entries: offset ? [] : [entry],
      offset,
      total: offset ? 2 : 3,
      hasMore: true,
    })),
    /changed/,
  );
  await assert.rejects(
    fetchRecipeSnapshot(async (offset, limit, revision) => {
      if (offset) assert.equal(revision, 'first');
      return {
        entries: offset ? [{ ...entry, id: 'pack:other' }] : [entry],
        offset,
        total: 2,
        hasMore: offset === 0,
        revision: offset ? 'reloaded' : 'first',
      };
    }),
    /revision changed/,
  );
});

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

test('Create assembly includes nested consumed inputs per loop and keeps the transitional item internal', () => {
  const step = (ingredient, keepHeldItem = false) => ({
    type: 'create:deploying',
    ingredients: [{ item: 'create:incomplete_precision_mechanism' }, ingredient],
    results: [{ id: 'create:incomplete_precision_mechanism' }],
    keep_held_item: keepHeldItem,
  });
  const raw = {
    ingredient: { item: 'gtceu:gold_plate' },
    loops: 5,
    transitional_item: { id: 'create:incomplete_precision_mechanism' },
    sequence: [
      step({ item: 'create:cogwheel' }),
      step({ item: 'gtceu:wrought_iron_ingot' }),
      step({ item: 'pack:mold' }, true),
    ],
    results: [
      { id: 'create:precision_mechanism', chance: 120 },
      { id: 'minecraft:gold_nugget', chance: 30 },
    ],
  };
  const recipe = normalizeRecipe({
    id: 'create:precision_mechanism',
    recipeType: 'create:sequenced_assembly',
    json: raw,
  });
  assert.deepEqual(
    recipe.inputs.map((s) => [s.id, s.count]),
    [
      ['gtceu:gold_plate', 1],
      ['create:cogwheel', 5],
      ['gtceu:wrought_iron_ingot', 5],
    ],
  );
  assert.equal(recipe.outputs[0].chance, 0.8);
  assert.equal(recipe.catalysts[0].id, 'pack:mold');
  assert.equal(recipe.catalysts[0].count, 1);
  assert.ok(!recipe.inputs.some((s) => s.id.includes('incomplete')));
  const unsupported = { ...raw, sequence: [{ type: 'pack:unknown_step', ingredients: [] }] };
  assert.equal(
    normalizeRecipe({
      id: 'pack:unsupported',
      recipeType: 'create:sequenced_assembly',
      json: unsupported,
    }),
    undefined,
  );
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
