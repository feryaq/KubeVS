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
  if (draft.actions.length === 0) throw new Error('Добавьте хотя бы одно действие с добычей.');

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
  if (!isRecord(value)) throw new Error('Модель правила LootJS должна быть объектом.');
  if (
    value.targetKind !== 'table' &&
    value.targetKind !== 'block' &&
    value.targetKind !== 'entity'
  ) {
    throw new Error('Выбран неподдерживаемый тип цели LootJS.');
  }
  if (typeof value.target !== 'string' || value.target.length > 300) {
    throw new Error('ID цели повреждён или слишком длинный.');
  }
  if (
    !Array.isArray(value.actions) ||
    value.actions.length > 100 ||
    !value.actions.every(isLootAction)
  ) {
    throw new Error('Список действий LootJS повреждён или слишком большой.');
  }
  validateCondition(value.condition);
  if (JSON.stringify(value).length > 128 * 1024) {
    throw new Error('Модель правила LootJS превышает допустимый размер.');
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
    if (!isRecord(candidate)) throw new Error('Условие должно быть объектом.');
    if (depth > MAX_DEPTH)
      throw new Error(`Глубина дерева условий не может превышать ${MAX_DEPTH}.`);
    if (++nodes > MAX_NODES)
      throw new Error(`Дерево условий не может содержать больше ${MAX_NODES} узлов.`);
    if (typeof candidate.id !== 'string' || !NODE_ID.test(candidate.id) || seen.has(candidate.id)) {
      throw new Error('У каждого условия должен быть уникальный безопасный ID.');
    }
    seen.add(candidate.id);
    if (!Array.isArray(candidate.children) || candidate.children.length > MAX_NODES) {
      throw new Error('Некорректный список дочерних условий.');
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
      throw new Error('Неподдерживаемый тип условия.');
    }
    if ((kind === 'and' || kind === 'or') && candidate.children.length < 1) {
      throw new Error(`${kind === 'and' ? 'AND' : 'OR'} должен содержать хотя бы одно условие.`);
    }
    if (kind === 'not' && candidate.children.length !== 1) {
      throw new Error('NOT должен содержать ровно одно условие.');
    }
    if (kind !== 'and' && kind !== 'or' && kind !== 'not' && candidate.children.length !== 0) {
      throw new Error('Листовое условие не может содержать дочерние элементы.');
    }
    if (
      kind === 'chance' &&
      (typeof candidate.value !== 'number' || !isProbability(candidate.value))
    ) {
      throw new Error('Шанс должен быть числом от 0 до 1.');
    }
    if (kind === 'tool' && (typeof candidate.value !== 'string' || candidate.value.length > 300)) {
      throw new Error('Фильтр инструмента повреждён.');
    }
    if (
      kind === 'custom' &&
      (typeof candidate.value !== 'string' || candidate.value.length > MAX_CUSTOM_JSON)
    ) {
      throw new Error(
        `Пользовательское JSON-условие не может превышать ${MAX_CUSTOM_JSON} символов.`,
      );
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
    if (!child) throw new Error('NOT должен содержать условие.');
    return { condition: 'minecraft:inverted', term: serializeCondition(child) };
  }
  if (node.kind === 'chance') {
    return { condition: 'minecraft:random_chance', chance: node.value };
  }
  if (node.kind === 'tool') {
    return {
      condition: 'minecraft:match_tool',
      predicate: { items: requireResourceOrTag(String(node.value ?? ''), 'Инструмент') },
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
    throw new Error('Пользовательское условие содержит некорректный JSON.');
  }
  if (!isRecord(parsed) || typeof parsed.condition !== 'string') {
    throw new Error('Пользовательское условие должно быть JSON-объектом с полем condition.');
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
      throw new Error('Пользовательское условие содержит запрещённое имя поля.');
    }
    assertSafeJson(child);
  }
}

function generateAction(action: LootAction): string {
  if (action.kind === 'add') {
    const item = requireResource(action.item, 'Предмет');
    const count = positiveInteger(action.count, 'Количество предметов');
    if (!isProbability(action.chance) || action.chance === 0) {
      throw new Error('Шанс добавления предмета должен быть больше 0 и не больше 1.');
    }
    if (count === 1 && action.chance === 1) return `modifier.addLoot(${JSON.stringify(item)})`;
    let entry = `LootEntry.of(${JSON.stringify(item)}, ${count})`;
    if (action.chance !== 1) entry += `.randomChance(${action.chance})`;
    return `modifier.addLoot(${entry})`;
  }
  if (action.kind === 'remove') {
    return `modifier.removeLoot(${JSON.stringify(requireResourceOrTag(action.filter, 'Фильтр удаления'))})`;
  }
  if (action.kind === 'replace') {
    return `modifier.replaceLoot(${JSON.stringify(requireResourceOrTag(action.filter, 'Фильтр замены'))}, ${JSON.stringify(requireResource(action.replacement, 'Новый предмет'))}, ${action.preserveCount})`;
  }
  if (!Number.isFinite(action.amount) || action.amount < 0) {
    throw new Error('Количество опыта должно быть неотрицательным числом.');
  }
  return `modifier.dropExperience(${action.amount})`;
}

function requireTarget(value: string, kind: LootTargetKind): string {
  return kind === 'table'
    ? requireResource(value, 'Таблица добычи')
    : requireResourceOrTag(value, kind === 'block' ? 'Блок' : 'Сущность');
}

function requireResourceOrTag(value: string, label: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('#')) return `#${requireResource(trimmed.slice(1), label)}`;
  return requireResource(trimmed, label);
}

function requireResource(value: string, label: string): string {
  const trimmed = value.trim();
  if (!RESOURCE_LOCATION.test(trimmed))
    throw new Error(`${label}: ожидается ID вида namespace:path.`);
  return trimmed;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label}: укажите целое число больше нуля.`);
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
