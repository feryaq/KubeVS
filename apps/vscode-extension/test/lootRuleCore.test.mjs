import assert from 'node:assert/strict';
import test from 'node:test';
import { generateLootRule, isLootRuleDraft, LOOT_RULE_PRESETS } from '../dist/lootRuleCore.mjs';

const leaf = (id, kind, value) => ({ id, kind, value, children: [] });
const base = {
  targetKind: 'table',
  target: 'minecraft:chests/simple_dungeon',
  condition: {
    id: 'root',
    kind: 'and',
    children: [leaf('chance', 'chance', 0.5)],
  },
  actions: [{ id: 'add', kind: 'add', item: 'minecraft:diamond', count: 1, chance: 1 }],
};

test('генерирует читаемый модификатор таблицы и действия', () => {
  const code = generateLootRule({
    ...base,
    actions: [
      { id: 'add', kind: 'add', item: 'minecraft:diamond', count: 2, chance: 0.25 },
      { id: 'remove', kind: 'remove', filter: '#minecraft:wool' },
      {
        id: 'replace',
        kind: 'replace',
        filter: 'minecraft:rotten_flesh',
        replacement: 'minecraft:leather',
        preserveCount: true,
      },
      { id: 'xp', kind: 'experience', amount: 8 },
    ],
  });

  assert.match(code, /event\.addTableModifier\("minecraft:chests\/simple_dungeon"\)/);
  assert.match(code, /LootEntry\.of\("minecraft:diamond", 2\)\.randomChance\(0\.25\)/);
  assert.match(code, /modifier\.removeLoot\("#minecraft:wool"\)/);
  assert.match(code, /modifier\.replaceLoot\(.+true\)/);
  assert.match(code, /modifier\.dropExperience\(8\)/);
});

test('сохраняет вложенную семантику AND, OR и NOT', () => {
  const code = generateLootRule({
    ...base,
    condition: {
      id: 'root',
      kind: 'and',
      children: [
        leaf('player', 'killedByPlayer'),
        {
          id: 'choice',
          kind: 'or',
          children: [
            leaf('tool', 'tool', '#minecraft:axes'),
            {
              id: 'inverse',
              kind: 'not',
              children: [leaf('explosion', 'survivesExplosion')],
            },
          ],
        },
      ],
    },
  });

  assert.match(code, /"condition": "minecraft:all_of"/);
  assert.match(code, /"condition": "minecraft:any_of"/);
  assert.match(code, /"condition": "minecraft:inverted"/);
  assert.match(code, /"condition": "minecraft:match_tool"/);
});

test('поддерживает блоки, сущности и пользовательское JSON-условие', () => {
  const block = generateLootRule({
    ...base,
    targetKind: 'block',
    target: '#minecraft:logs',
    condition: leaf('custom', 'custom', '{"condition":"minecraft:weather_check","raining":true}'),
  });
  const entity = generateLootRule({
    ...base,
    targetKind: 'entity',
    target: 'minecraft:zombie',
  });

  assert.match(block, /addBlockModifier\("#minecraft:logs"\)/);
  assert.match(block, /"condition": "minecraft:weather_check"/);
  assert.match(entity, /addEntityModifier\("minecraft:zombie"\)/);
});

test('отклоняет пустые группы, неверные шансы и опасный JSON', () => {
  assert.throws(
    () => generateLootRule({ ...base, condition: { id: 'root', kind: 'and', children: [] } }),
    /хотя бы одно условие/,
  );
  assert.throws(
    () => generateLootRule({ ...base, condition: leaf('chance', 'chance', 2) }),
    /от 0 до 1/,
  );
  assert.throws(
    () =>
      generateLootRule({
        ...base,
        condition: leaf(
          'custom',
          'custom',
          '{"condition":"minecraft:killed_by_player","constructor":{"x":1}}',
        ),
      }),
    /запрещённое имя поля/,
  );
});

test('ограничивает глубину и проверяет уникальность ID', () => {
  let condition = leaf('last', 'chance', 0.5);
  for (let index = 0; index < 13; index += 1) {
    condition = { id: `not${index}`, kind: 'not', children: [condition] };
  }
  assert.equal(isLootRuleDraft({ ...base, condition }), false);
  assert.equal(
    isLootRuleDraft({
      ...base,
      condition: {
        id: 'root',
        kind: 'and',
        children: [leaf('same', 'chance', 0.2), leaf('same', 'chance', 0.3)],
      },
    }),
    false,
  );
});

test('все готовые пресеты генерируют валидные LootJS-модификаторы', () => {
  const generated = Object.values(LOOT_RULE_PRESETS).map(generateLootRule);
  assert.equal(generated.length, 6);
  assert.ok(generated.some((code) => code.includes('addTableModifier')));
  assert.ok(generated.some((code) => code.includes('addBlockModifier')));
  assert.ok(generated.some((code) => code.includes('addEntityModifier')));
});
