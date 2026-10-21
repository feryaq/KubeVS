import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildRecipeFromSchema,
  generateKubeJs,
  inferRecipeSchemaFromJson,
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

test('parsed recipe schemas can be passed back through MCP without losing validation', () => {
  const raw = {
    version: 1,
    id: 'kubevs:roundtrip',
    label: 'Roundtrip',
    recipeType: 'example:machine',
    fields: [{ path: 'input', label: 'Input', kind: 'ingredient', required: true }],
  };
  const parsed = parseRecipeSchema(raw);
  assert.deepEqual(parseRecipeSchema(JSON.parse(JSON.stringify(parsed))), parsed);
  assert.throws(
    () => parseRecipeSchema({ ...raw, fields: [{ ...raw.fields[0], minItems: 1 }] }),
    /only valid when multiple/,
  );
});

test('infers a lossless editable template for nested custom recipes', () => {
  const source = {
    type: 'pneumaticcraft:pressure_chamber',
    inputs: [{ type: 'pneumaticcraft:stacked_item', item: 'minecraft:iron_ingot', count: 3 }],
    outputs: [
      {
        item: {
          id: 'minecraft:compressed_iron',
          count: 2,
          components: { 'minecraft:custom_data': { grade: 1 } },
        },
        chance: 0.75,
      },
    ],
    fluid: { type: 'pneumaticcraft:fluid', fluid: 'minecraft:water', amount: 250 },
    conditions: [{ type: 'pneumaticcraft:air', min_pressure: 2.5 }],
    tags: ['kubejs:custom'],
    static: { keep: true },
  };
  const schema = inferRecipeSchemaFromJson({
    id: 'kubevs:pressure',
    label: 'Pressure Chamber',
    json: source,
  });

  assert.equal(schema.recipeType, source.type);
  assert.ok(schema.fields.some((field) => field.path === 'outputs.0.chance') === false);
  assert.ok(schema.fields.some((field) => field.path === 'outputs' && field.kind === 'json'));
  assert.ok(
    schema.fields.some((field) => field.path === 'fluid.amount' && field.kind === 'integer'),
  );
  assert.ok(schema.fields.some((field) => field.path === 'conditions' && field.kind === 'json'));
  assert.deepEqual(buildRecipeFromSchema(schema, { values: {} }), source);

  const edited = buildRecipeFromSchema(schema, {
    values: {
      'fluid.amount': '500',
      outputs: JSON.stringify([{ ...source.outputs[0], chance: 0.4 }]),
    },
  });
  assert.equal(edited.fluid.amount, 500);
  assert.equal(edited.outputs[0].chance, 0.4);
  assert.deepEqual(edited.inputs, source.inputs);
  assert.deepEqual(edited.conditions, source.conditions);
  assert.deepEqual(edited.tags, source.tags);
  assert.deepEqual(source.fluid, {
    type: 'pneumaticcraft:fluid',
    fluid: 'minecraft:water',
    amount: 250,
  });
});

test('inferred templates reject unsafe JSON keys', () => {
  const source = JSON.parse('{"type":"example:machine","__proto__":{"polluted":true}}');
  assert.throws(
    () => inferRecipeSchemaFromJson({ id: 'kubevs:unsafe', label: 'Unsafe', json: source }),
    /unsafe JSON key/u,
  );
});

test('infers exact native ingredient and stack list fields', () => {
  const source = {
    type: 'example:machine',
    ingredients: [{ item: 'minecraft:iron_ingot' }, { item: 'minecraft:copper_ingot' }],
    ingredientTags: [{ tag: 'c:dusts/iron' }, { tag: 'c:dusts/copper' }],
    outputs: [{ id: 'minecraft:iron_block', count: 2 }, { id: 'minecraft:gold_ingot' }],
    labels: ['primary', 'secondary'],
    itemIds: ['minecraft:stone', 'minecraft:dirt'],
  };
  const schema = inferRecipeSchemaFromJson({
    id: 'kubevs:native_fields',
    label: 'Native fields',
    json: source,
  });
  const ingredients = schema.fields.find((field) => field.path === 'ingredients');
  const outputs = schema.fields.find((field) => field.path === 'outputs');

  assert.equal(ingredients.kind, 'ingredient');
  assert.equal(ingredients.multiple, true);
  assert.deepEqual(ingredients.default, ['minecraft:iron_ingot', 'minecraft:copper_ingot']);
  const ingredientTags = schema.fields.find((field) => field.path === 'ingredientTags');
  assert.equal(ingredientTags.kind, 'ingredient');
  assert.deepEqual(ingredientTags.default, ['#c:dusts/iron', '#c:dusts/copper']);
  assert.equal(outputs.kind, 'item_stack');
  assert.equal(outputs.multiple, true);
  assert.deepEqual(outputs.default, ['minecraft:iron_block x 2', 'minecraft:gold_ingot']);
  assert.equal(schema.fields.find((field) => field.path === 'labels').kind, 'string');
  assert.equal(schema.fields.find((field) => field.path === 'itemIds').kind, 'resource_id');
  assert.deepEqual(buildRecipeFromSchema(schema, { values: {} }), source);
  assert.deepEqual(
    buildRecipeFromSchema(schema, {
      values: {
        ingredients: ['minecraft:copper_ingot', '#c:ingots/iron'],
        ingredientTags: ['#c:ingots/copper'],
        outputs: ['minecraft:gold_block', 'minecraft:iron_ingot x 3'],
      },
    }).outputs,
    [{ id: 'minecraft:gold_block' }, { id: 'minecraft:iron_ingot', count: 3 }],
  );
});

test('keeps non-exact stack shapes as JSON fields', () => {
  const source = {
    type: 'example:machine',
    explicitOne: [{ id: 'minecraft:iron_ingot', count: 1 }],
    withComponents: [
      {
        id: 'minecraft:iron_ingot',
        count: 2,
        components: { 'minecraft:custom_data': { grade: 1 } },
      },
    ],
    withChance: [{ id: 'minecraft:iron_ingot', chance: 0.25 }],
    singleExplicitOne: { id: 'minecraft:gold_ingot', count: 1 },
  };
  const schema = inferRecipeSchemaFromJson({
    id: 'kubevs:json_fallbacks',
    label: 'JSON fallbacks',
    json: source,
  });

  for (const path of ['explicitOne', 'withComponents', 'withChance', 'singleExplicitOne']) {
    assert.equal(schema.fields.find((field) => field.path === path).kind, 'json');
  }
  assert.deepEqual(buildRecipeFromSchema(schema, { values: {} }), source);
});

test('infers a single plain ingredient or item stack only when exactly representable', () => {
  const source = {
    type: 'example:machine',
    ingredient: { tag: 'c:ingots/iron' },
    result: { id: 'minecraft:iron_block', count: 4 },
  };
  const schema = inferRecipeSchemaFromJson({
    id: 'kubevs:single_fields',
    label: 'Single fields',
    json: source,
  });
  assert.equal(schema.fields.find((field) => field.path === 'ingredient').kind, 'ingredient');
  assert.equal(
    schema.fields.find((field) => field.path === 'ingredient').default,
    '#c:ingots/iron',
  );
  assert.equal(schema.fields.find((field) => field.path === 'result').kind, 'item_stack');
  assert.equal(
    schema.fields.find((field) => field.path === 'result').default,
    'minecraft:iron_block x 4',
  );
  assert.deepEqual(buildRecipeFromSchema(schema, { values: {} }), source);
});
