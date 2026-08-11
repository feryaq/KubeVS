export type LootTargetKind = 'table' | 'block' | 'entity';
export type LootConditionKind =
  'and' | 'or' | 'not' | 'chance' | 'tool' | 'killedByPlayer' | 'survivesExplosion' | 'custom';

export interface LootConditionNode {
  readonly id: string;
  readonly kind: LootConditionKind;
  readonly value?: number | string;
  readonly children: readonly LootConditionNode[];
}

export type LootAction =
  | {
      readonly id: string;
      readonly kind: 'add';
      readonly item: string;
      readonly count: number;
      readonly chance: number;
    }
  | { readonly id: string; readonly kind: 'remove'; readonly filter: string }
  | {
      readonly id: string;
      readonly kind: 'replace';
      readonly filter: string;
      readonly replacement: string;
      readonly preserveCount: boolean;
    }
  | { readonly id: string; readonly kind: 'experience'; readonly amount: number };

export interface LootRuleDraft {
  readonly targetKind: LootTargetKind;
  readonly target: string;
  readonly condition: LootConditionNode;
  readonly actions: readonly LootAction[];
}

export const LOOT_RULE_PRESETS = {
  chest: {
    targetKind: 'table',
    target: 'minecraft:chests/simple_dungeon',
    condition: {
      id: 'root',
      kind: 'and',
      children: [{ id: 'n1', kind: 'chance', value: 0.2, children: [] }],
    },
    actions: [{ id: 'a1', kind: 'add', item: 'minecraft:emerald', count: 1, chance: 1 }],
  },
  fishing: {
    targetKind: 'table',
    target: 'minecraft:gameplay/fishing',
    condition: {
      id: 'root',
      kind: 'and',
      children: [{ id: 'n1', kind: 'chance', value: 0.03, children: [] }],
    },
    actions: [{ id: 'a1', kind: 'add', item: 'minecraft:diamond', count: 1, chance: 1 }],
  },
  leaves: {
    targetKind: 'block',
    target: '#minecraft:leaves',
    condition: {
      id: 'root',
      kind: 'and',
      children: [
        { id: 'n1', kind: 'survivesExplosion', children: [] },
        { id: 'n2', kind: 'chance', value: 0.05, children: [] },
      ],
    },
    actions: [{ id: 'a1', kind: 'add', item: 'minecraft:apple', count: 1, chance: 1 }],
  },
  stone: {
    targetKind: 'block',
    target: 'minecraft:stone',
    condition: {
      id: 'root',
      kind: 'and',
      children: [
        { id: 'n1', kind: 'survivesExplosion', children: [] },
        { id: 'n2', kind: 'chance', value: 0.08, children: [] },
      ],
    },
    actions: [{ id: 'a1', kind: 'add', item: 'minecraft:flint', count: 1, chance: 1 }],
  },
  zombie: {
    targetKind: 'entity',
    target: 'minecraft:zombie',
    condition: {
      id: 'root',
      kind: 'and',
      children: [
        { id: 'n1', kind: 'killedByPlayer', children: [] },
        { id: 'n2', kind: 'chance', value: 0.05, children: [] },
      ],
    },
    actions: [
      { id: 'a1', kind: 'add', item: 'minecraft:iron_ingot', count: 1, chance: 1 },
      { id: 'a2', kind: 'experience', amount: 2 },
    ],
  },
  skeleton: {
    targetKind: 'entity',
    target: 'minecraft:skeleton',
    condition: {
      id: 'root',
      kind: 'and',
      children: [{ id: 'n1', kind: 'killedByPlayer', children: [] }],
    },
    actions: [{ id: 'a1', kind: 'add', item: 'minecraft:arrow', count: 2, chance: 0.5 }],
  },
} satisfies Readonly<Record<string, LootRuleDraft>>;
const RESOURCE_LOCATION = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/;
const NODE_ID = /^[A-Za-z0-9_-]{1,80}$/;
const MAX_NODES = 100;
const MAX_DEPTH = 12;
const MAX_CUSTOM_JSON = 16 * 1024;

export function isLootRuleDraft(value: unknown): value is LootRuleDraft {
  try {
    validateDraft(value);
    return true;
  } catch {
    return false;
  }
}

export function generateLootRule(draft: LootRuleDraft): string {
  validateDraft(draft);
  const target = requireTarget(draft.target, draft.targetKind);
  if (draft.actions.length === 0) throw new Error('Add at least one loot action.');

  const condition = serializeCondition(draft.condition);
  const method =
    draft.targetKind === 'table'
      ? 'addTableModifier'
      : draft.targetKind === 'block'
        ? 'addBlockModifier'
        : 'addEntityModifier';
  const lines = [
    'LootJS.modifiers(event => {',
    `  const modifier = event.${method}(${JSON.stringify(target)})`,
    `  modifier.matchCustomCondition(${indent(JSON.stringify(condition, null, 2), 2)})`,
  ];
  for (const action of draft.actions) lines.push(`  ${generateAction(action)}`);
  lines.push('})', '');
  return lines.join('\n');
}

function validateDraft(value: unknown): asserts value is LootRuleDraft {
  if (!isRecord(value)) throw new Error('The LootJS rule model must be an object.');
  if (
    value.targetKind !== 'table' &&
    value.targetKind !== 'block' &&
    value.targetKind !== 'entity'
  ) {
    throw new Error('The selected LootJS target type is not supported.');
  }
  if (typeof value.target !== 'string' || value.target.length > 300) {
    throw new Error('The target ID is invalid or too long.');
  }
  if (
    !Array.isArray(value.actions) ||
    value.actions.length > 100 ||
    !value.actions.every(isLootAction)
  ) {
    throw new Error('The LootJS action list is invalid or too large.');
  }
  validateCondition(value.condition);
  if (JSON.stringify(value).length > 128 * 1024) {
    throw new Error('The LootJS rule model exceeds the allowed size.');
  }
}

function isLootAction(value: unknown): value is LootAction {
  if (!isRecord(value) || typeof value.id !== 'string' || !NODE_ID.test(value.id)) return false;
  if (value.kind === 'add') {
    return (
      typeof value.item === 'string' &&
      value.item.length <= 300 &&
      typeof value.count === 'number' &&
      typeof value.chance === 'number'
    );
  }
  if (value.kind === 'remove') {
    return typeof value.filter === 'string' && value.filter.length <= 300;
  }
  if (value.kind === 'replace') {
    return (
      typeof value.filter === 'string' &&
      value.filter.length <= 300 &&
      typeof value.replacement === 'string' &&
      value.replacement.length <= 300 &&
      typeof value.preserveCount === 'boolean'
    );
  }
  return value.kind === 'experience' && typeof value.amount === 'number';
}

function validateCondition(value: unknown): asserts value is LootConditionNode {
  const seen = new Set<string>();
  let nodes = 0;
  const visit = (candidate: unknown, depth: number): void => {
    if (!isRecord(candidate)) throw new Error('A condition must be an object.');
    if (depth > MAX_DEPTH) throw new Error(`Condition tree depth cannot exceed ${MAX_DEPTH}.`);
    if (++nodes > MAX_NODES)
      throw new Error(`The condition tree cannot contain more than ${MAX_NODES} nodes.`);
    if (typeof candidate.id !== 'string' || !NODE_ID.test(candidate.id) || seen.has(candidate.id)) {
      throw new Error('Every condition must have a unique safe ID.');
    }
    seen.add(candidate.id);
    if (!Array.isArray(candidate.children) || candidate.children.length > MAX_NODES) {
      throw new Error('Invalid child condition list.');
    }
    const kind = candidate.kind;
    if (
      kind !== 'and' &&
      kind !== 'or' &&
      kind !== 'not' &&
      kind !== 'chance' &&
      kind !== 'tool' &&
      kind !== 'killedByPlayer' &&
      kind !== 'survivesExplosion' &&
      kind !== 'custom'
    ) {
      throw new Error('Unsupported condition type.');
    }
    if ((kind === 'and' || kind === 'or') && candidate.children.length < 1) {
      throw new Error(`${kind === 'and' ? 'AND' : 'OR'} must contain at least one condition.`);
    }
    if (kind === 'not' && candidate.children.length !== 1) {
      throw new Error('NOT must contain exactly one condition.');
    }
    if (kind !== 'and' && kind !== 'or' && kind !== 'not' && candidate.children.length !== 0) {
      throw new Error('A leaf condition cannot contain child nodes.');
    }
    if (
      kind === 'chance' &&
      (typeof candidate.value !== 'number' || !isProbability(candidate.value))
    ) {
      throw new Error('Chance must be a number from 0 to 1.');
    }
    if (kind === 'tool' && (typeof candidate.value !== 'string' || candidate.value.length > 300)) {
      throw new Error('The tool filter is invalid.');
    }
    if (
      kind === 'custom' &&
      (typeof candidate.value !== 'string' || candidate.value.length > MAX_CUSTOM_JSON)
    ) {
      throw new Error(`The custom JSON condition cannot exceed ${MAX_CUSTOM_JSON} characters.`);
    }
    for (const child of candidate.children) visit(child, depth + 1);
  };
  visit(value, 1);
}

function serializeCondition(node: LootConditionNode): Record<string, unknown> {
  if (node.kind === 'and') {
    return { condition: 'minecraft:all_of', terms: node.children.map(serializeCondition) };
  }
  if (node.kind === 'or') {
    return { condition: 'minecraft:any_of', terms: node.children.map(serializeCondition) };
  }
  if (node.kind === 'not') {
    const child = node.children.at(0);
    if (!child) throw new Error('NOT must contain a condition.');
    return { condition: 'minecraft:inverted', term: serializeCondition(child) };
  }
  if (node.kind === 'chance') {
    return { condition: 'minecraft:random_chance', chance: node.value };
  }
  if (node.kind === 'tool') {
    return {
      condition: 'minecraft:match_tool',
      predicate: { items: requireResourceOrTag(String(node.value ?? ''), 'Tool') },
    };
  }
  if (node.kind === 'killedByPlayer') return { condition: 'minecraft:killed_by_player' };
  if (node.kind === 'survivesExplosion') return { condition: 'minecraft:survives_explosion' };
  return parseCustomCondition(String(node.value ?? ''));
}

function parseCustomCondition(source: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error('The custom condition contains invalid JSON.');
  }
  if (!isRecord(parsed) || typeof parsed.condition !== 'string') {
    throw new Error('The custom condition must be a JSON object with a condition field.');
  }
  assertSafeJson(parsed);
  return parsed;
}

function assertSafeJson(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(assertSafeJson);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
      throw new Error('The custom condition contains a forbidden field name.');
    }
    assertSafeJson(child);
  }
}

function generateAction(action: LootAction): string {
  if (action.kind === 'add') {
    const item = requireResource(action.item, 'Item');
    const count = positiveInteger(action.count, 'Item count');
    if (!isProbability(action.chance) || action.chance === 0) {
      throw new Error('Item chance must be greater than 0 and no greater than 1.');
    }
    if (count === 1 && action.chance === 1) return `modifier.addLoot(${JSON.stringify(item)})`;
    let entry = `LootEntry.of(${JSON.stringify(item)}, ${count})`;
    if (action.chance !== 1) entry += `.randomChance(${action.chance})`;
    return `modifier.addLoot(${entry})`;
  }
  if (action.kind === 'remove') {
    return `modifier.removeLoot(${JSON.stringify(requireResourceOrTag(action.filter, 'Removal filter'))})`;
  }
  if (action.kind === 'replace') {
    return `modifier.replaceLoot(${JSON.stringify(requireResourceOrTag(action.filter, 'Replacement filter'))}, ${JSON.stringify(requireResource(action.replacement, 'Replacement item'))}, ${action.preserveCount})`;
  }
  if (!Number.isFinite(action.amount) || action.amount < 0) {
    throw new Error('Experience amount must be a non-negative number.');
  }
  return `modifier.dropExperience(${action.amount})`;
}

function requireTarget(value: string, kind: LootTargetKind): string {
  return kind === 'table'
    ? requireResource(value, 'Loot table')
    : requireResourceOrTag(value, kind === 'block' ? 'Block' : 'Entity');
}

function requireResourceOrTag(value: string, label: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('#')) return `#${requireResource(trimmed.slice(1), label)}`;
  return requireResource(trimmed, label);
}

function requireResource(value: string, label: string): string {
  const trimmed = value.trim();
  if (!RESOURCE_LOCATION.test(trimmed))
    throw new Error(`${label}: expected an ID in namespace:path format.`);
  return trimmed;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label}: enter an integer greater than zero.`);
  }
  return value;
}

function isProbability(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function indent(value: string, spaces: number): string {
  const prefix = ' '.repeat(spaces);
  return value
    .split('\n')
    .map((line, index) => (index === 0 ? line : `${prefix}${line}`))
    .join('\n');
}
