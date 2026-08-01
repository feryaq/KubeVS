import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRecipeReplacement, isRecipeId } from '../dist/recipeReplacementCore.mjs';

test('replacement always uses the target recipe ID, never the source ID', () => {
  const replacement = buildRecipeReplacement('minecraft:sticks', 'minecraft:oak_planks', {
    type: 'minecraft:crafting_shapeless',
    ingredients: [{ item: 'minecraft:oak_log' }],
    result: { id: 'minecraft:oak_planks', count: 4 },
  });

  assert.equal(replacement.targetId, 'minecraft:sticks');
  assert.equal(replacement.recipeType, 'minecraft:crafting_shapeless');
  assert.match(replacement.code, /\.id\("minecraft:sticks"\)/);
  assert.doesNotMatch(replacement.code, /\.id\("minecraft:oak_planks"\)/);
  assert.match(replacement.code, /Определение взято из minecraft:oak_planks/);
});

test('generic recipes preserve raw fields while overriding the ID', () => {
  const replacement = buildRecipeReplacement('pack:machine/result', 'mod:template', {
    type: 'create:mixing',
    ingredients: [{ item: 'minecraft:iron_ingot' }],
    results: [{ id: 'create:andesite_alloy' }],
    heatRequirement: 'heated',
  });

  assert.match(replacement.code, /"heatRequirement": "heated"/);
  assert.match(replacement.code, /\.id\("pack:machine\/result"\)/);
  assert.equal(replacement.warnings.length, 1);
});

test('invalid target and source IDs are rejected', () => {
  assert.equal(isRecipeId('create:mixing/brass'), true);
  assert.equal(isRecipeId('Brass Recipe'), false);
  assert.throws(
    () =>
      buildRecipeReplacement('bad id', 'minecraft:stick', {
        type: 'minecraft:crafting_shapeless',
        ingredients: [],
        result: 'minecraft:stick',
      }),
    /ID заменяемого рецепта/,
  );
});
