import assert from 'node:assert/strict';
import test from 'node:test';
import { generateContentScript, suggestedContentId } from '../dist/contentBuilderCore.mjs';

test('creates an ID from an English name without manual input', () => {
  assert.equal(suggestedContentId('Reinforced Iron Plate'), 'kubejs:reinforced_iron_plate');
});

test('generates a readable item startup script', () => {
  const code = generateContentScript({
    kind: 'item',
    id: 'kubejs:test_plate',
    displayName: 'Test Plate',
    textureItem: 'minecraft:iron_ingot',
    maxStackSize: 32,
    rarity: 'uncommon',
    glow: true,
    tooltip: 'For recipe debugging',
    hardness: 2,
    resistance: 6,
    soundType: 'metal',
    requiresTool: true,
    miningTool: 'pickaxe',
  });
  assert.match(code, /StartupEvents\.registry\("item"/u);
  assert.doesNotMatch(code, /\.texture\(/u);
  assert.match(code, /\.maxStackSize\(32\)/u);
});

test('generates a basic block with a required tool', () => {
  const code = generateContentScript({
    kind: 'block',
    id: 'kubejs:test_block',
    displayName: 'Test Block',
    textureItem: 'minecraft:iron_block',
    maxStackSize: 64,
    rarity: 'common',
    glow: false,
    tooltip: '',
    hardness: 3,
    resistance: 8,
    soundType: 'metal',
    requiresTool: true,
    miningTool: 'pickaxe',
  });
  assert.match(code, /StartupEvents\.registry\("block"/u);
  assert.match(code, /\.hardness\(3\)/u);
  assert.match(code, /\.tagBlock\("minecraft:mineable\/pickaxe"\)/u);
});

test('rejects a forged content type and an incompatible tool requirement', () => {
  const draft = {
    kind: 'block',
    id: 'kubejs:test_block',
    displayName: 'Test Block',
    textureItem: '',
    maxStackSize: 64,
    rarity: 'common',
    glow: false,
    tooltip: '',
    hardness: 3,
    resistance: 8,
    soundType: 'metal',
    requiresTool: true,
    miningTool: 'none',
  };
  assert.throws(() => generateContentScript(draft), /Select a mining tool/u);
  assert.throws(
    () => generateContentScript({ ...draft, kind: "item', evil()" }),
    /Unknown content type/u,
  );
});
