import { canonicalRecipeLabel, defaultWorkstations } from './recipePresentation.js';

export { canonicalRecipeLabel, defaultWorkstations } from './recipePresentation.js';

export type FlowKind = 'item' | 'tag' | 'fluid';

export interface RecipeSnapshotEntry {
  readonly id: string;
  readonly recipeType: string;
  readonly json: unknown;
}

export interface FlowStack {
  readonly kind: FlowKind;
  readonly id: string;
  readonly count: number;
  readonly chance: number;
}

export interface CraftRecipe {
  readonly id: string;
  readonly recipeType: string;
  readonly label?: string;
  readonly categoryId?: string;
  readonly catalysts?: readonly FlowStack[];
  readonly workstations?: readonly FlowStack[];
  readonly inputs: readonly FlowStack[];
  readonly outputs: readonly FlowStack[];
  readonly duration: number;
  readonly energy: number;
}

export interface CraftTreeNode {
  readonly item: FlowStack;
  readonly required: number;
  readonly recipeId?: string;
  readonly recipeType?: string;
  readonly recipeLabel?: string;
  readonly categoryId?: string;
  readonly catalysts: readonly FlowStack[];
  readonly workstations: readonly FlowStack[];
  readonly batches: number;
  readonly alternatives: number;
  readonly selectedAlternative: number;
  readonly duration: number;
  readonly energy: number;
  readonly byproducts: readonly FlowStack[];
  readonly children: readonly CraftTreeNode[];
  readonly state: 'crafted' | 'base' | 'cycle' | 'depth';
}

export interface CraftTotals {
  readonly items: Readonly<Record<string, number>>;
  readonly fluids: Readonly<Record<string, number>>;
  readonly duration: number;
  readonly energy: number;
}

const INPUT_KEYS = ['ingredient', 'ingredients', 'input', 'inputs', 'base', 'addition', 'template'];
const OUTPUT_KEYS = ['result', 'results', 'output', 'outputs'];

export function normalizeRecipe(entry: RecipeSnapshotEntry): CraftRecipe | undefined {
  const raw = asRecord(entry.json);
  if (!raw) return undefined;
  const inputs =
    Array.isArray(raw.pattern) && asRecord(raw.key)
      ? shapedInputs(raw.pattern, asRecord(raw.key) ?? {})
      : collectFields(raw, INPUT_KEYS);
  const outputs = normalizeOutputChances(collectFields(raw, OUTPUT_KEYS));
  if (outputs.length === 0) return undefined;
  return {
    id: entry.id,
    recipeType: entry.recipeType,
    label: canonicalRecipeLabel(entry.recipeType),
    workstations: workstationStacks(entry.recipeType),
    inputs: mergeStacks(inputs),
    outputs: mergeStacks(outputs),
    duration: positiveNumber(
      raw.processingTime ?? raw.processing_time ?? raw.cookingtime ?? raw.duration,
      0,
    ),
    energy: positiveNumber(raw.energy ?? raw.energyCost ?? raw.energy_cost, 0),
  };
}

export function buildCraftTree(
  recipes: readonly CraftRecipe[],
  targetId: string,
  amount: number,
  selections: Readonly<Record<string, string>> = {},
  maxDepth = 8,
  maxNodes = 5000,
): CraftTreeNode {
  const byOutput = new Map<string, CraftRecipe[]>();
  for (const recipe of recipes) {
    for (const output of recipe.outputs) {
      const group = byOutput.get(output.id) ?? [];
      group.push(recipe);
      byOutput.set(output.id, group);
    }
  }
  for (const group of byOutput.values()) group.sort((a, b) => a.id.localeCompare(b.id, 'en'));
  let nodes = 0;

  const visit = (
    stack: FlowStack,
    required: number,
    depth: number,
    ancestors: ReadonlySet<string>,
  ): CraftTreeNode => {
    nodes++;
    if (nodes > maxNodes || depth >= maxDepth) return leaf(stack, required, 'depth');
    if (ancestors.has(stack.id)) return leaf(stack, required, 'cycle');
    const alternatives = byOutput.get(stack.id) ?? [];
    if (stack.kind !== 'item' || alternatives.length === 0) return leaf(stack, required, 'base');
    const requested = selections[stack.id];
    const selectedIndex = Math.max(
      0,
      requested ? alternatives.findIndex((recipe) => recipe.id === requested) : 0,
    );
    const recipe = alternatives[selectedIndex] ?? alternatives[0];
    if (!recipe) return leaf(stack, required, 'base');
    const output = recipe.outputs.find((candidate) => candidate.id === stack.id);
    const expectedYield = Math.max(0.000001, (output?.count ?? 1) * (output?.chance ?? 1));
    const batches = Math.ceil(required / expectedYield);
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(stack.id);
    return {
      item: stack,
      required,
      recipeId: recipe.id,
      recipeType: recipe.recipeType,
      recipeLabel: recipe.label ?? canonicalRecipeLabel(recipe.recipeType),
      ...(recipe.categoryId === undefined ? {} : { categoryId: recipe.categoryId }),
      catalysts: recipe.catalysts ?? [],
      workstations: recipe.workstations ?? workstationStacks(recipe.recipeType),
      batches,
      alternatives: alternatives.length,
      selectedAlternative: selectedIndex,
      duration: recipe.duration * batches,
      energy: recipe.energy * batches,
      byproducts: recipe.outputs
        .filter((candidate) => candidate.id !== stack.id)
        .map((candidate) => ({
          ...candidate,
          count: candidate.count * candidate.chance * batches,
          chance: 1,
        })),
      children: recipe.inputs.map((input) =>
        visit(input, input.count * batches, depth + 1, nextAncestors),
      ),
      state: 'crafted',
    };
  };

  return visit({ kind: 'item', id: targetId, count: 1, chance: 1 }, amount, 0, new Set());
}

export function calculateCraftTotals(root: CraftTreeNode): CraftTotals {
  const items: Record<string, number> = {};
  const fluids: Record<string, number> = {};
  let duration = 0;
  let energy = 0;
  const visit = (node: CraftTreeNode): void => {
    duration += node.duration;
    energy += node.energy;
    if (node.state !== 'crafted') {
      const target = node.item.kind === 'fluid' ? fluids : items;
      target[node.item.kind === 'tag' ? `#${node.item.id}` : node.item.id] =
        (target[node.item.kind === 'tag' ? `#${node.item.id}` : node.item.id] ?? 0) + node.required;
      return;
    }
    node.children.forEach(visit);
  };
  visit(root);
  return { items, fluids, duration, energy };
}

function leaf(item: FlowStack, required: number, state: 'base' | 'cycle' | 'depth'): CraftTreeNode {
  return {
    item,
    required,
    batches: 0,
    alternatives: 0,
    selectedAlternative: 0,
    duration: 0,
    energy: 0,
    catalysts: [],
    workstations: [],
    byproducts: [],
    children: [],
    state,
  };
}

function workstationStacks(recipeType: string): FlowStack[] {
  return defaultWorkstations(recipeType).map((id) => ({
    kind: 'item',
    id,
    count: 1,
    chance: 1,
  }));
}

function shapedInputs(pattern: unknown[], key: Readonly<Record<string, unknown>>): FlowStack[] {
  const counts = new Map<string, number>();
  for (const row of pattern) {
    if (typeof row !== 'string') continue;
    for (const symbol of row) {
      if (symbol !== ' ') counts.set(symbol, (counts.get(symbol) ?? 0) + 1);
    }
  }
  return [...counts].flatMap(([symbol, count]) =>
    collectStacks(key[symbol], true).map((stack) => ({ ...stack, count: stack.count * count })),
  );
}

function collectFields(
  raw: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): FlowStack[] {
  return keys.flatMap((key) => {
    const value = raw[key];
    if (
      (key === 'ingredients' || key === 'inputs' || key === 'results' || key === 'outputs') &&
      Array.isArray(value)
    ) {
      return value.flatMap((entry) => collectStacks(entry, true));
    }
    return collectStacks(value, true);
  });
}

function collectStacks(value: unknown, alternatives = false): FlowStack[] {
  if (Array.isArray(value)) {
    if (!alternatives) return value.flatMap((entry) => collectStacks(entry));
    for (const option of value) {
      const stacks = collectStacks(option);
      if (stacks.length > 0) return stacks;
    }
    return [];
  }
  if (typeof value === 'string') {
    const tagged = value.startsWith('#');
    const id = tagged ? value.slice(1) : value;
    return isResourceId(id) ? [{ kind: tagged ? 'tag' : 'item', id, count: 1, chance: 1 }] : [];
  }
  const object = asRecord(value);
  if (!object) return [];
  const count = positiveNumber(object.count ?? object.amount, 1);
  const chance = probability(object.chance);
  if (typeof object.tag === 'string' && isResourceId(object.tag)) {
    return [{ kind: 'tag', id: object.tag, count, chance }];
  }
  if (typeof object.fluid === 'string' && isResourceId(object.fluid)) {
    return [{ kind: 'fluid', id: object.fluid, count, chance }];
  }
  const id =
    typeof object.id === 'string'
      ? object.id
      : typeof object.item === 'string'
        ? object.item
        : undefined;
  if (id && isResourceId(id)) return [{ kind: 'item', id, count, chance }];
  return Object.values(object).flatMap((entry) => collectStacks(entry));
}

function mergeStacks(stacks: readonly FlowStack[]): FlowStack[] {
  const merged = new Map<string, FlowStack>();
  for (const stack of stacks) {
    const key = `${stack.kind}:${stack.id}:${stack.chance}`;
    const current = merged.get(key);
    merged.set(key, current ? { ...current, count: current.count + stack.count } : stack);
  }
  return [...merged.values()];
}

function probability(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 1;
  return value;
}

function normalizeOutputChances(outputs: readonly FlowStack[]): FlowStack[] {
  if (!outputs.some((output) => output.chance > 1)) return [...outputs];
  const totalWeight = outputs.reduce((sum, output) => sum + output.chance, 0);
  if (totalWeight <= 0) return [...outputs];
  return outputs.map((output) => ({ ...output, chance: output.chance / totalWeight }));
}

function positiveNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function isResourceId(value: string): boolean {
  return /^[a-z0-9_.-]+:[a-z0-9_./-]+$/u.test(value);
}
