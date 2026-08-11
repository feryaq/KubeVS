import assert from 'node:assert/strict';
import test from 'node:test';
import {
  generateRecipeRemovalScript,
  parseRemovedRecipeIds,
  withRemovedRecipe,
  withoutRemovedRecipe,
} from '../dist/recipeRemovalCore.mjs';

test('normalizes the removed recipe list', () => {
  assert.deepEqual(
    parseRemovedRecipeIds(['minecraft:stick', 'bad id', 'minecraft:stick', 'create:mixing/test']),
    ['create:mixing/test', 'minecraft:stick'],
  );
});

test('adds, restores, and generates a readable event.remove', () => {
  const removed = withRemovedRecipe(['minecraft:stick'], 'create:brass_hand');
  assert.deepEqual(withoutRemovedRecipe(removed, 'minecraft:stick'), ['create:brass_hand']);
  assert.match(
    generateRecipeRemovalScript(removed),
    /event\.remove\(\{ id: "create:brass_hand" \}\)/u,
  );
});
