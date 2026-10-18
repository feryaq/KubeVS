import assert from 'node:assert/strict';
import test from 'node:test';
import {
  generateAddonRecipe,
  generateGregtechRecipe,
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
