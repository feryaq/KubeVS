import assert from 'node:assert/strict';
import test from 'node:test';
import {
  generateAddonRecipe,
  generateGregtechRecipe,
  generateGregtechShapedRecipe,
  gregtechOperationControls,
  gregtechOperationNames,
  isAddonRecipeDraft,
} from '../dist/addonRecipeCore.mjs';

const recipe = {
  machine: 'assembler',
  recipeId: 'kubevs:reinforced_plate',
  itemInputs: ['2x minecraft:iron_ingot', '#c:plates/copper'],
  fluidInputs: [{ fluid: 'minecraft:water', amount: 250 }],
  itemOutputs: [
    { item: 'minecraft:diamond', count: 2, chance: 1 },
    { item: 'minecraft:gravel', count: 1, chance: 0.125 },
  ],
  fluidOutputs: [{ fluid: 'minecraft:lava', amount: 100 }],
  nonConsumableItems: ['minecraft:bucket'],
  nonConsumableFluids: [{ fluid: 'minecraft:water', amount: 50 }],
  circuit: 2,
  duration: 200,
  eut: 30,
  posY: { min: 0, max: 128 },
};

test('GTCEu 1.21 machine recipe emits its KubeJS builder and exact chance units', () => {
  const code = generateGregtechRecipe(recipe);
  assert.match(code, /event\.recipes\.gtceu\.assembler\("kubevs:reinforced_plate"\)/);
  assert.match(code, /\.itemInputs\("2x minecraft:iron_ingot"\)/);
  assert.match(code, /\.itemInputs\("1x #c:plates\/copper"\)/);
  assert.match(code, /\.inputFluids\(Fluid\.of\("minecraft:water", 250\)\)/);
  assert.match(code, /\.notConsumableItem\("1x minecraft:bucket"\)/);
  assert.match(code, /\.notConsumableFluid\(Fluid\.of\("minecraft:water", 50\)\)/);
  assert.match(code, /\.circuit\(2\)/);
  assert.match(code, /\.chancedOutput\("1x minecraft:gravel", 1250\)/);
  assert.match(code, /\.posY\(0, 128\)/);
  assert.match(code, /\.duration\(200\)/);
  assert.match(code, /\.EUt\(30, 1\)/);
  assert.doesNotThrow(() => new Function('ServerEvents', 'Fluid', code));
});

test('GTCEu generator accepts negative EU/t and rejects invalid boundary values', () => {
  assert.match(generateGregtechRecipe({ ...recipe, eut: -32 }), /\.EUt\(-32, 1\)/);
  for (const broken of [
    { ...recipe, machine: 'assembler;throw Error()' },
    { ...recipe, circuit: 33 },
    { ...recipe, eut: 0 },
    { ...recipe, itemOutputs: [{ item: 'minecraft:stone', count: 1, chance: 0 }] },
    { ...recipe, itemOutputs: [{ item: '#c:stones', count: 1, chance: 1 }] },
    { ...recipe, fluidOutputs: [{ fluid: '#c:water', amount: 100 }] },
    { ...recipe, posY: { min: 10, max: 0 } },
  ])
    assert.throws(() => generateGregtechRecipe(broken));
});

test('Mod Recipes draft routes GTCEu to the builder instead of event.custom', () => {
  const draft = {
    type: 'gtceu:machine',
    recipeId: recipe.recipeId,
    ingredients: recipe.itemInputs,
    fluidInputs: recipe.fluidInputs,
    outputs: recipe.itemOutputs,
    fluidOutputs: recipe.fluidOutputs,
    processingTime: recipe.duration,
    experience: 0,
    heat: 'none',
    loops: 1,
    transitionalItem: '',
    tool: '',
    sequence: [],
    gregtech: recipe,
  };
  assert.equal(isAddonRecipeDraft(draft), true);
  const code = generateAddonRecipe(draft);
  assert.match(code, /event\.recipes\.gtceu\.assembler/);
  assert.doesNotMatch(code, /event\.custom/);
});

test('advanced GTCEu recipe executes validated builder calls with tick and chance scope', () => {
  const calls = [];
  const builder = new Proxy(
    {},
    {
      get(_target, key) {
        return (...args) => {
          calls.push([key, ...args]);
          return builder;
        };
      },
    },
  );
  const event = {
    recipes: {
      gtceu: {
        assembler(id) {
          calls.push(['assembler', id]);
          return builder;
        },
      },
    },
  };
  const code = generateGregtechRecipe({
    ...recipe,
    itemInputs: [],
    fluidInputs: [],
    itemOutputs: [],
    fluidOutputs: [],
    nonConsumableItems: [],
    nonConsumableFluids: [],
    circuit: null,
    posY: null,
    cleanroom: 'sterile_cleanroom',
    blastFurnaceTemp: 1800,
    operations: [
      { op: 'itemInput', item: 'minecraft:copper_ingot', count: 2, chance: 0, tick: true },
      { op: 'fluidOutput', fluid: 'minecraft:water', amount: 250, chance: 0.25 },
      { op: 'rain', value: 0.5, reverse: true },
      { op: 'addDataBool', key: 'custom_flag', value: true },
    ],
  });
  new Function('ServerEvents', 'Fluid', 'CleanroomType', code)(
    {
      recipes(callback) {
        callback(event);
      },
    },
    { of: (id, amount) => ({ id, amount }) },
    { STERILE_CLEANROOM: Symbol('sterile') },
  );
  assert.deepEqual(
    calls.filter(([method]) =>
      ['perTick', 'notConsumableItem', 'chancedFluidOutput'].includes(method),
    ),
    [
      ['perTick', true],
      ['notConsumableItem', '2x minecraft:copper_ingot'],
      ['perTick', false],
      ['chancedFluidOutput', { id: 'minecraft:water', amount: 250 }, 2500],
    ],
  );
  assert.ok(
    calls.some(
      ([method, value, reverse]) => method === 'rain' && value === 0.5 && reverse === true,
    ),
  );
  assert.ok(calls.some(([method, value]) => method === 'blastFurnaceTemp' && value === 1800));
  assert.ok(calls.some(([method, value]) => method === 'cleanroom' && typeof value === 'symbol'));
});

test('advanced GTCEu operations reject unknown code and malformed values', () => {
  for (const operation of [
    { op: 'invalid_json', value: 'Unexpected token' },
    { op: 'itemInput', item: 'minecraft:iron_ingot', count: 0 },
    { op: 'itemOutput', item: 'minecraft:iron_ingot', chance: 0 },
    { op: 'fluidOutput', fluid: 'minecraft:water', amount: 100, chance: 1.1 },
    { op: 'rain', value: 2 },
    { op: 'posY', min: 100, max: 10 },
    { op: 'addDataString', key: 'x', value: 'ok', injected: '); throw Error()' },
    { op: 'daytime', value: 'false' },
  ])
    assert.throws(() => generateGregtechRecipe({ ...recipe, operations: [operation] }));
});

test('research lambdas and Java key conditions are generated from typed data', () => {
  const code = generateGregtechRecipe({
    ...recipe,
    operations: [
      { op: 'dimension', id: 'minecraft:the_nether', reverse: true },
      { op: 'biomeTag', id: 'minecraft:is_ocean' },
      { op: 'scannerResearch', item: 'minecraft:diamond', duration: 1200, eut: 512 },
      { op: 'stationResearch', fluid: 'minecraft:water', amount: 1000, cwu: 16, totalCwu: 4000 },
    ],
  });
  const recorded = [];
  const research = new Proxy(
    {},
    {
      get(_target, key) {
        return (...args) => {
          recorded.push([key, ...args]);
          return research;
        };
      },
    },
  );
  const builder = new Proxy(
    {},
    {
      get(_target, key) {
        return (...args) => {
          recorded.push([key, ...args]);
          if (
            key === 'scannerResearch(java.util.function.UnaryOperator)' ||
            key === 'stationResearch'
          )
            args[0](research);
          return builder;
        };
      },
    },
  );
  const event = {
    recipes: {
      gtceu: {
        assembler() {
          return builder;
        },
      },
    },
  };
  const classes = {
    'net.minecraft.resources.ResourceLocation': { parse: (id) => ({ id }) },
    'net.minecraft.resources.ResourceKey': { create: (registry, value) => ({ registry, value }) },
    'net.minecraft.tags.TagKey': { create: (registry, value) => ({ registry, value }) },
    'net.minecraft.core.registries.Registries': { DIMENSION: 'dimension', BIOME: 'biome' },
  };
  new Function('ServerEvents', 'Fluid', 'Item', 'CleanroomType', 'Java', code)(
    {
      recipes(callback) {
        callback(event);
      },
    },
    { of: (id, amount) => ({ id, amount }) },
    { of: (id) => ({ id }) },
    {},
    {
      loadClass(name) {
        assert.ok(name in classes);
        return classes[name];
      },
    },
  );
  assert.ok(
    recorded.some(
      ([method, key, reverse]) =>
        method === 'dimension' && key.registry === 'dimension' && reverse === true,
    ),
  );
  assert.ok(recorded.some(([method, key]) => method === 'biomeTag' && key.registry === 'biome'));
  assert.ok(
    recorded.some(
      ([method, value]) => method === 'researchStack' && value.id === 'minecraft:diamond',
    ),
  );
  assert.ok(recorded.some(([method, a, b]) => method === 'CWUt' && a === 16 && b === 4000));
});

test('GTCEu numeric bounds follow Java int for recipe values', () => {
  for (const broken of [
    { ...recipe, duration: 2_147_483_648 },
    { ...recipe, fluidInputs: [{ fluid: 'minecraft:water', amount: 2_147_483_648 }] },
    { ...recipe, operations: [{ op: 'CWUt', value: -2_147_483_648 - 1 }] },
    {
      ...recipe,
      operations: [{ op: 'stationResearch', item: 'minecraft:stone', cwu: 8, totalCwu: 7 }],
    },
  ])
    assert.throws(() => generateGregtechRecipe(broken));
});

test('every GTCEu operation has editable fields and a valid executable example', () => {
  assert.deepEqual(
    new Set(gregtechOperationControls.map((control) => control.op)),
    new Set(gregtechOperationNames),
  );
  const methods = new Set([
    'circuit',
    'itemInputs',
    'itemOutputs',
    'inputFluids',
    'outputFluids',
    'input',
    'output',
    'inputItemsRanged',
    'outputItemsRanged',
    'inputFluidsRanged',
    'outputFluidsRanged',
    'notConsumableItem',
    'notConsumableFluid',
    'chancedInput',
    'chancedOutput',
    'chancedFluidInput',
    'chancedFluidOutput',
    'perTick',
    'duration',
    'EUt',
    'inputEU',
    'outputEU',
    'CWUt',
    'inputCWU',
    'outputCWU',
    'totalCWU',
    'addDataString',
    'addDataNumber',
    'addDataBool',
    'addData',
    'explosivesAmount',
    'explosivesType',
    'solderMultiplier',
    'fusionStartEU',
    'disableDistilleryRecipes',
    'researchScan',
    'durationIsTotalCWU',
    'hideDuration',
    'rain',
    'thunder',
    'posY',
    'daytime',
    'nighttime',
    'heraclesQuest',
    'ftbQuest',
    'researchWithoutRecipe',
    'category',
    'chancedItemInputLogic',
    'chancedFluidInputLogic',
    'chancedItemOutputLogic',
    'chancedFluidOutputLogic',
    'chancedTickInputLogic',
    'chancedTickOutputLogic',
    'environmentalHazard',
    'addMaterialInfo',
    'removePreviousMaterialInfo',
    'dimension',
    'biome',
    'biomeTag',
    'adjacentFluids',
    'adjacentFluidTag',
    'adjacentBlocks',
    'adjacentBlockTag',
    'scannerResearch(java.util.function.UnaryOperator)',
    'stationResearch',
    'addCondition',
  ]);
  const registry = { get: (id) => id, asLookup: () => ({}) };
  const javaClasses = {
    'net.minecraft.resources.ResourceLocation': { parse: (id) => id },
    'net.minecraft.resources.ResourceKey': { create: (registry, id) => ({ registry, id }) },
    'net.minecraft.tags.TagKey': { create: (registry, id) => ({ registry, id }) },
    'net.minecraft.core.registries.Registries': {
      ITEM: 'item',
      FLUID: 'fluid',
      BLOCK: 'block',
      DIMENSION: 'dimension',
      BIOME: 'biome',
    },
    'net.minecraft.core.registries.BuiltInRegistries': {
      ITEM: registry,
      FLUID: registry,
      BLOCK: registry,
    },
    'net.minecraft.world.item.crafting.Ingredient': { of: (id) => id },
    'net.neoforged.neoforge.fluids.crafting.FluidIngredient': { of: (id) => id },
    'net.neoforged.neoforge.fluids.crafting.SizedFluidIngredient': {
      of: (id, amount) => ({ id, amount }),
    },
    'net.minecraft.commands.arguments.blocks.BlockStateParser': {
      parseForBlock: (_, state) => ({ blockState: () => state }),
    },
    'net.minecraft.nbt.TagParser': { parseTag: (snbt) => ({ snbt }) },
    ...Object.fromEntries(
      ['VentCondition', 'EUToStartCondition', 'CleanroomCondition'].map((name) => [
        'com.gregtechceu.gtceu.common.recipe.condition.' + name,
        class {
          constructor(...args) {
            this.args = args;
          }
        },
      ]),
    ),
  };
  for (const control of gregtechOperationControls) {
    const calls = [];
    const research = new Proxy(
      {},
      {
        get:
          (_, key) =>
          (...args) => {
            assert.ok(
              [
                'researchStack',
                'researchFluidStack',
                'researchId',
                'dataStack',
                'EUt',
                'duration',
                'CWUt',
              ].includes(key),
            );
            calls.push([key, ...args]);
            return research;
          },
      },
    );
    const builder = new Proxy(
      {},
      {
        get:
          (_, key) =>
          (...args) => {
            assert.ok(methods.has(key), String(key));
            calls.push([key, ...args]);
            if (String(key).includes('Research')) args[0](research);
            return builder;
          },
      },
    );
    const code = generateGregtechRecipe({ ...recipe, operations: [control.example] });
    new Function('ServerEvents', 'Fluid', 'Item', 'Ingredient', 'CleanroomType', 'Java', code)(
      { recipes: (callback) => callback({ recipes: { gtceu: { assembler: () => builder } } }) },
      { of: (id, amount) => ({ id, amount }) },
      { of: (id) => ({ id }) },
      { of: (ids, count) => ({ ids, count }) },
      { CLEANROOM: 'cleanroom', STERILE_CLEANROOM: 'sterile' },
      {
        loadClass: (name) => {
          assert.ok(name in javaClasses, name);
          return javaClasses[name];
        },
      },
    );
    assert.ok(calls.length > 0, control.op);
    for (const field of control.fields)
      if (field.required) assert.ok(field.key in control.example, control.op + '.' + field.key);
  }
});

test('GTCEu supports fuel generators, large fusion startup, tags and exact fractions', () => {
  assert.match(
    generateGregtechRecipe({ ...recipe, itemOutputs: [], fluidOutputs: [], eut: -32 }),
    /EUt\(-32, 1\)/,
  );
  const code = generateGregtechRecipe({
    ...recipe,
    fluidInputs: [{ fluid: '#c:water', amount: 1000 }],
    operations: [
      { op: 'fusionStartEU', value: 10_000_000_000 },
      { op: 'itemOutput', item: 'minecraft:diamond', fraction: '1/3' },
      { op: 'itemInputRanged', item: '#c:ingots/iron', min: 0, max: 2 },
    ],
  });
  assert.match(code, /SizedFluidIngredient/);
  assert.match(code, /fusionStartEU\(10000000000\)/);
  assert.match(code, /chancedOutput\("1x minecraft:diamond", "1\/3"\)/);
  assert.match(
    generateGregtechRecipe({ ...recipe, itemInputs: ['minecraft:diamond[minecraft:damage=1]'] }),
    /minecraft:damage=1/,
  );
});

test('GT tool crafting preserves lowercase tool symbols and validates its 3×3 grid', () => {
  const draft = {
    recipeId: 'kubevs:plate',
    pattern: ['hA', ' A'],
    key: { A: '#c:ingots/iron' },
    output: 'minecraft:iron_nugget',
    count: 2,
    mirrored: false,
    addMaterialInfo: true,
  };
  const calls = [];
  const builder = {
    id: (value) => {
      calls.push(['id', value]);
      return builder;
    },
    noMirror: () => builder,
    addMaterialInfo: () => builder,
  };
  new Function('ServerEvents', generateGregtechShapedRecipe(draft))({
    recipes: (callback) =>
      callback({
        recipes: {
          gtceu: {
            shaped: (...args) => {
              calls.push(args);
              return builder;
            },
          },
        },
      }),
  });
  assert.deepEqual(calls[0], ['2x minecraft:iron_nugget', ['hA', ' A'], { A: '#c:ingots/iron' }]);
  for (const invalid of [
    { ...draft, pattern: ['AAAA'] },
    { ...draft, pattern: ['Z'], key: {} },
    { ...draft, count: 0 },
  ])
    assert.throws(() => generateGregtechShapedRecipe(invalid));
});
