import assert from 'node:assert/strict';
import test from 'node:test';
import {
  craftCategory,
  generatedArtifactStem,
  generatedDirectorySegments,
  safeGeneratedSegment,
} from '../dist/generatedTargetCore.mjs';

test('не дублирует kubejs, когда открыта сама папка kubejs', () => {
  assert.deepEqual(generatedDirectorySegments('KubeJS', 'kubejs/server_scripts/kubevs-generated'), [
    'server_scripts',
    'kubevs-generated',
  ]);
});

test('не дублирует server_scripts, когда открыта папка скриптов', () => {
  assert.deepEqual(
    generatedDirectorySegments('server_scripts', 'kubejs/server_scripts/kubevs-generated'),
    ['kubevs-generated'],
  );
});

test('сохраняет полный путь для корня Minecraft-сборки', () => {
  assert.deepEqual(
    generatedDirectorySegments('My Modpack', 'kubejs/server_scripts/kubevs-generated'),
    ['kubejs', 'server_scripts', 'kubevs-generated'],
  );
});

test('раскладывает рецепты по стабильным папкам интеграций', () => {
  assert.equal(craftCategory('create:pressing'), 'create');
  assert.equal(craftCategory('oritech:pulverizer'), 'oritech');
  assert.equal(craftCategory('farmersdelight:cooking'), 'farmersdelight');
  assert.equal(craftCategory('minecraft:crafting_shaped'), 'vanilla');
  assert.equal(craftCategory('othermod:machine'), 'generic');
});

test('не пропускает путь через имя генерируемого файла', () => {
  assert.equal(safeGeneratedSegment('simple_dungeon', 'loot_rule'), 'simple_dungeon');
  assert.equal(safeGeneratedSegment('../outside', 'loot_rule'), 'loot_rule');
});

test('не сталкивает namespace и похожие пути в одном generated-файле', () => {
  assert.notEqual(
    generatedArtifactStem('create:foo/bar', 'recipe'),
    generatedArtifactStem('create:foo_bar', 'recipe'),
  );
  assert.notEqual(
    generatedArtifactStem('mod_a:chests/simple', 'loot'),
    generatedArtifactStem('mod_b:chests/simple', 'loot'),
  );
});
