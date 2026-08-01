import assert from 'node:assert/strict';
import test from 'node:test';
import { generateContentScript, suggestedContentId } from '../dist/contentBuilderCore.mjs';

test('создаёт ID из русского названия без ручного ввода', () => {
  assert.equal(
    suggestedContentId('Усиленная железная пластина'),
    'kubejs:usilennaya_zheleznaya_plastina',
  );
});

test('генерирует читаемый startup-скрипт предмета', () => {
  const code = generateContentScript({
    kind: 'item',
    id: 'kubejs:test_plate',
    displayName: 'Тестовая пластина',
    textureItem: 'minecraft:iron_ingot',
    maxStackSize: 32,
    rarity: 'uncommon',
    glow: true,
    tooltip: 'Для отладки рецептов',
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

test('генерирует базовый блок с инструментом', () => {
  const code = generateContentScript({
    kind: 'block',
    id: 'kubejs:test_block',
    displayName: 'Тестовый блок',
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

test('отклоняет поддельный тип контента и несовместимое требование инструмента', () => {
  const draft = {
    kind: 'block',
    id: 'kubejs:test_block',
    displayName: 'Тестовый блок',
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
  assert.throws(() => generateContentScript(draft), /выберите его тип/u);
  assert.throws(
    () => generateContentScript({ ...draft, kind: "item', evil()" }),
    /Неизвестный тип/u,
  );
});
