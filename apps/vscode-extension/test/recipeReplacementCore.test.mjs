import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildRecipeReplacement,
  isRecipeId,
  patchRecipeDefinition,
  recipePointer,
  verifyRecipeFields,
} from '../dist/recipeReplacementCore.mjs';

test('explicit nested Create edits preserve unrelated sequence fields and detect stale ingredients', () => {
  const raw = {
    type: 'create:sequenced_assembly',
    ingredient: { tag: 'c:plates/gold' },
    transitional_item: { id: 'create:incomplete_precision_mechanism' },
    sequence: [
      {
        type: 'create:deploying',
        ingredients: [{ item: 'create:incomplete_precision_mechanism' }, { tag: 'c:nuggets/iron' }],
        results: [{ id: 'create:incomplete_precision_mechanism' }],
      },
    ],
    loops: 5,
    results: [
      { id: 'create:precision_mechanism', chance: 120 },
      { id: 'minecraft:gold_nugget', chance: 8 },
    ],
  };
  const edits = [
    {
      path: '/ingredient',
      expected: { tag: 'c:plates/gold' },
      value: { item: 'gtceu:gold_plate' },
    },
    {
      path: '/sequence/0/ingredients/1',
      expected: { tag: 'c:nuggets/iron' },
      value: { item: 'gtceu:wrought_iron_ingot' },
    },
  ];
  const patched = patchRecipeDefinition('create:precision_mechanism', raw, edits);
  assert.deepEqual(patched.json.results, raw.results);
  assert.equal(patched.json.loops, 5);
  assert.deepEqual(patched.json.sequence[0].results, raw.sequence[0].results);
  assert.deepEqual(raw.ingredient, { tag: 'c:plates/gold' });
  assert.doesNotMatch(patched.code, /replaceInput|c:nuggets\/iron|c:plates\/gold/);
  assert.match(patched.code, /event\.remove/);
  assert.match(patched.code, /event\.custom/);
  assert.deepEqual(
    verifyRecipeFields(
      patched.json,
      edits.map((e) => ({ path: e.path, expected: e.value })),
    ),
    { matches: true, failures: [] },
  );
  assert.equal(
    verifyRecipeFields(
      raw,
      edits.map((e) => ({ path: e.path, expected: e.value })),
    ).matches,
    false,
  );
  assert.throws(
    () => patchRecipeDefinition('pack:r', raw, [{ ...edits[0], expected: 'stale' }]),
    /conflict/,
  );
  assert.throws(
    () =>
      patchRecipeDefinition('pack:r', raw, [{ path: '/__proto__/foo', expected: null, value: 1 }]),
    /Unsafe/,
  );
  assert.throws(
    () => patchRecipeDefinition('pack:r', raw, [{ path: '/missing', expected: null, value: 1 }]),
    /does not exist/,
  );
  assert.throws(() => recipePointer(raw, '/sequence/~2'), /JSON Pointer/);
});

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
  assert.match(replacement.code, /Definition copied from minecraft:oak_planks/);
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
    /Recipe ID to replace/,
  );
});
