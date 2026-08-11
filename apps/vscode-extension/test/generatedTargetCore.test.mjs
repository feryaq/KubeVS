import assert from 'node:assert/strict';
import test from 'node:test';
import {
  craftCategory,
  generatedArtifactStem,
  generatedDirectorySegments,
  safeGeneratedSegment,
} from '../dist/generatedTargetCore.mjs';

test('does not duplicate kubejs when the kubejs folder itself is open', () => {
  assert.deepEqual(generatedDirectorySegments('KubeJS', 'kubejs/server_scripts/kubevs-generated'), [
    'server_scripts',
    'kubevs-generated',
  ]);
});

test('does not duplicate kubejs in a remote server workspace', () => {
  assert.deepEqual(
    generatedDirectorySegments('', 'kubejs/server_scripts/kubevs', 'kubevs-remote'),
    ['server_scripts', 'kubevs'],
  );
});

test('does not duplicate server_scripts when the scripts folder is open', () => {
  assert.deepEqual(
    generatedDirectorySegments('server_scripts', 'kubejs/server_scripts/kubevs-generated'),
    ['kubevs-generated'],
  );
});

test('keeps the full path for a Minecraft instance root', () => {
  assert.deepEqual(
    generatedDirectorySegments('My Modpack', 'kubejs/server_scripts/kubevs-generated'),
    ['kubejs', 'server_scripts', 'kubevs-generated'],
  );
});

test('routes recipes into stable integration folders', () => {
  assert.equal(craftCategory('create:pressing'), 'create');
  assert.equal(craftCategory('oritech:pulverizer'), 'oritech');
  assert.equal(craftCategory('farmersdelight:cooking'), 'farmersdelight');
  assert.equal(craftCategory('minecraft:crafting_shaped'), 'vanilla');
  assert.equal(craftCategory('othermod:machine'), 'generic');
});

test('does not allow path traversal through a generated filename', () => {
  assert.equal(safeGeneratedSegment('simple_dungeon', 'loot_rule'), 'simple_dungeon');
  assert.equal(safeGeneratedSegment('../outside', 'loot_rule'), 'loot_rule');
});

test('creates readable canonical filenames without a hash suffix', () => {
  assert.equal(
    generatedArtifactStem('kubevs:iron_ingot_from_smelting_iron_ore', 'recipe'),
    'iron_ingot_from_smelting_iron_ore',
  );
  assert.equal(
    generatedArtifactStem('create:pressing/iron_sheet', 'recipe'),
    'create--pressing__iron_sheet',
  );
});

test('avoids collisions between namespaces and similar paths in one generated file', () => {
  assert.notEqual(
    generatedArtifactStem('create:foo/bar', 'recipe'),
    generatedArtifactStem('create:foo_bar', 'recipe'),
  );
  assert.notEqual(
    generatedArtifactStem('mod_a:chests/simple', 'loot'),
    generatedArtifactStem('mod_b:chests/simple', 'loot'),
  );
});
