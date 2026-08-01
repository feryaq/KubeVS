import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildRecipeFromSchema,
  generateKubeJs,
  importRecipeJson,
  parseRecipeSchema,
} from '../dist/index.js';

test('imports and generates a readable shaped recipe', () => {
  const imported = importRecipeJson('kubevs:test_pickaxe', {
    type: 'minecraft:crafting_shaped',
    pattern: ['AAA', ' B ', ' B '],
    key: {
      A: { tag: 'c:ingots/iron' },
      B: 'minecraft:stick',
    },
    result: { id: 'minecraft:iron_pickaxe', count: 1 },
  });

  assert.equal(imported.recipe.kind, 'vanilla_shaped');
  assert.deepEqual(imported.issues, []);
  const code = generateKubeJs(imported.recipe);
  assert.match(code, /^event\.shaped/u);
  assert.match(code, /#c:ingots\/iron/u);
  assert.match(code, /\.id\("kubevs:test_pickaxe"\)$/u);
});

test('preserves unknown recipe schemas for the generic editor', () => {
  const source = {
    type: 'create:mixing',
    ingredients: [{ item: 'minecraft:andesite' }],
    results: [{ id: 'create:andesite_alloy' }],
    heat_requirement: 'heated',
  };
  const imported = importRecipeJson(undefined, source);

  assert.equal(imported.recipe.kind, 'generic');
  assert.equal(imported.issues[0]?.severity, 'warning');
  assert.match(generateKubeJs(imported.recipe), /^event\.custom/u);
  assert.deepEqual(imported.recipe.kind === 'generic' ? imported.recipe.raw : undefined, source);
});

test('reports a shaped pattern with a missing key mapping', () => {
  const imported = importRecipeJson(undefined, {
    type: 'minecraft:crafting_shaped',
    pattern: ['AB'],
    key: { A: 'minecraft:stone' },
    result: 'minecraft:stone_button',
  });

  assert.equal(imported.issues[0]?.severity, 'error');
});

test('uses the documented KubeJS campfire cooking API', () => {
  const imported = importRecipeJson('kubevs:campfire_test', {
    type: 'minecraft:campfire_cooking',
    ingredient: 'minecraft:stick',
    result: { id: 'minecraft:torch', count: 2 },
    experience: 0.35,
    cookingtime: 600,
  });

  assert.equal(imported.recipe.kind, 'vanilla_cooking');
  assert.match(
    generateKubeJs(imported.recipe),
    /^event\.campfireCooking\(Item\.of\("minecraft:torch", 2\), "minecraft:stick", 0\.35, 600\)/u,
  );
});

test('generates fluent cooking time for furnace recipes', () => {
  const imported = importRecipeJson(undefined, {
    type: 'minecraft:smelting',
    ingredient: '#c:ores/iron',
    result: 'minecraft:iron_ingot',
    experience: 0.7,
    cookingtime: 160,
  });

  assert.match(
    generateKubeJs(imported.recipe),
    /^event\.smelting\("minecraft:iron_ingot", "#c:ores\/iron"\)\.xp\(0\.7\)\.cookingTime\(160\)$/u,
  );
});

test('builds a nested custom recipe from a validated schema', () => {
  const schema = parseRecipeSchema({
    version: 1,
    id: 'kubevs:test_machine',
    label: 'Test Machine',
    recipeType: 'example:machine',
    fields: [
      {
        path: 'ingredients',
        label: 'Ingredients',
        kind: 'ingredient',
        required: true,
        multiple: true,
        minItems: 1,
      },
      {
        path: 'result.primary',
        label: 'Result',
        kind: 'item_stack',
        required: true,
      },
      {
        path: 'settings.duration',
        label: 'Duration',
        kind: 'integer',
        default: 200,
      },
      {
        path: 'settings.mode',
        label: 'Mode',
        kind: 'enum',
        options: ['normal', 'fast'],
        default: 'normal',
      },
    ],
  });

  assert.deepEqual(
    buildRecipeFromSchema(schema, {
      recipeId: 'kubevs:test',
      values: {
        ingredients: ['minecraft:stone', '#c:dusts/redstone'],
        'result.primary': 'minecraft:diamond x 2',
        'settings.duration': '120',
      },
    }),
    {
      type: 'example:machine',
      ingredients: [{ item: 'minecraft:stone' }, { tag: 'c:dusts/redstone' }],
      result: { primary: { id: 'minecraft:diamond', count: 2 } },
      settings: { duration: 120, mode: 'normal' },
    },
  );
});

test('rejects unsafe custom schema paths', () => {
  assert.throws(
    () =>
      parseRecipeSchema({
        version: 1,
        id: 'kubevs:unsafe',
        label: 'Unsafe',
        recipeType: 'example:unsafe',
        fields: [{ path: '__proto__.polluted', label: 'Unsafe', kind: 'string' }],
      }),
    /safe dot-separated object path/u,
  );
});

test('rejects values that are not declared by the schema', () => {
  const schema = parseRecipeSchema({
    version: 1,
    id: 'kubevs:strict',
    label: 'Strict',
    recipeType: 'example:strict',
    fields: [{ path: 'value', label: 'Value', kind: 'string' }],
  });

  assert.throws(
    () => buildRecipeFromSchema(schema, { values: { unexpected: 'nope' } }),
    /field is not defined/u,
  );
});

test('supports a dynamic recipe type with a safe raw JSON body', () => {
  const schema = parseRecipeSchema({
    version: 1,
    id: 'kubevs:raw',
    label: 'Raw Custom Recipe',
    fields: [
      { path: 'type', label: 'Recipe type', kind: 'resource_id', required: true },
      { path: '$', label: 'Recipe body', kind: 'json', required: true },
    ],
  });

  assert.deepEqual(
    buildRecipeFromSchema(schema, {
      values: {
        type: 'example:machine',
        $: '{"type":"ignored:override","energy":400,"chance":0.25}',
      },
    }),
    { energy: 400, chance: 0.25, type: 'example:machine' },
  );
});

test('rejects prototype-polluting keys inside raw JSON', () => {
  const schema = parseRecipeSchema({
    version: 1,
    id: 'kubevs:raw',
    label: 'Raw Custom Recipe',
    fields: [
      { path: 'type', label: 'Recipe type', kind: 'resource_id', required: true },
      { path: '$', label: 'Recipe body', kind: 'json', required: true },
    ],
  });

  assert.throws(
    () =>
      buildRecipeFromSchema(schema, {
        values: { type: 'example:machine', $: '{"__proto__":{"polluted":true}}' },
      }),
    /unsafe JSON key/u,
  );
});

test('rejects schema combinations the visual editor cannot represent', () => {
  const base = {
    version: 1,
    id: 'kubevs:invalid_multiple',
    label: 'Invalid Multiple',
    recipeType: 'example:machine',
  };
  assert.throws(
    () =>
      parseRecipeSchema({
        ...base,
        fields: [{ path: 'flags', label: 'Flags', kind: 'boolean', multiple: true }],
      }),
    /boolean lists are not supported/u,
  );
  assert.throws(
    () =>
      parseRecipeSchema({
        ...base,
        fields: [{ path: '$', label: 'Body', kind: 'json', multiple: true }],
      }),
    /root "\$" JSON field cannot be a list/u,
  );
});
