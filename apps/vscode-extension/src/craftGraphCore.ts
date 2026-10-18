import { canonicalRecipeLabel, defaultWorkstations } from './recipePresentation.js';
export { fetchRecipeSnapshot } from './recipeSnapshotCore.js';

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

/** Lossless wire encoding: recipe metadata once, ordered node values instead of repeated keys. */
export function packCraftTree(root: CraftTreeNode): {
  columns: readonly string[];
  recipes: Record<string, Record<string, unknown>>;
  nodes: unknown[][];
} {
  const columns = [
    'item',
    'required',
    'recipeId',
    'batches',
    'alternatives',
    'selectedAlternative',
    'duration',
    'energy',
    'byproducts',
    'children',
    'state',
  ];
  const recipes: Record<string, Record<string, unknown>> = {};
  const nodes: unknown[][] = [];
  const visit = (node: CraftTreeNode): number => {
    const index = nodes.length;
    const row: unknown[] = [];
    nodes.push(row);
    if (node.recipeId)
      recipes[node.recipeId] = {
        recipeType: node.recipeType,
        recipeLabel: node.recipeLabel,
        ...(node.categoryId === undefined ? {} : { categoryId: node.categoryId }),
        catalysts: node.catalysts,
        workstations: node.workstations,
      };
    row.push(
      node.item,
      node.required,
      node.recipeId ?? null,
      node.batches,
      node.alternatives,
      node.selectedAlternative,
      node.duration,
      node.energy,
      node.byproducts,
      node.children.map(visit),
      node.state,
    );
    return index;
  };
  visit(root);
  return { columns, recipes, nodes };
}

const INPUT_KEYS = ['ingredient', 'ingredients', 'input', 'inputs', 'base', 'addition', 'template'];
const OUTPUT_KEYS = ['result', 'results', 'output', 'outputs'];

export function normalizeRecipe(entry: RecipeSnapshotEntry): CraftRecipe | undefined {
  const raw = asRecord(entry.json);
  if (!raw) return undefined;
  if (entry.recipeType === 'create:sequenced_assembly') return normalizeCreateSequence(entry, raw);
  if (entry.recipeType.startsWith('gtceu:') && asRecord(raw.inputs) && asRecord(raw.outputs)) {
    return normalizeGregtechRecipe(entry, raw);
  }
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

// Create mc1.21.1: SequencedAssemblyRecipe and generated precision_mechanism.json.
// https://github.com/Creators-of-Create/Create/tree/mc1.21.1/dev
function normalizeCreateSequence(
  entry: RecipeSnapshotEntry,
  raw: Readonly<Record<string, unknown>>,
): CraftRecipe | undefined {
  const transitional = collectStacks(raw.transitional_item)[0];
  const base = collectStacks(raw.ingredient, true);
  const loops = positiveNumber(raw.loops, 5);
  if (
    !transitional ||
    !base.length ||
    !Number.isInteger(loops) ||
    loops < 1 ||
    !Array.isArray(raw.sequence) ||
    !raw.sequence.length
  )
    return undefined;
  const inputs = [...base],
    catalysts: FlowStack[] = [],
    workstations: FlowStack[] = [];
  let duration = 0;
  for (const value of raw.sequence) {
    const step = asRecord(value),
      type = step?.type;
    if (
      !step ||
      typeof type !== 'string' ||
      !['create:deploying', 'create:pressing', 'create:cutting'].includes(type)
    )
      return undefined;
    const stacks = collectFields(step, INPUT_KEYS);
    if (stacks[0]?.id !== transitional.id) return undefined;
    for (const stack of stacks.slice(1)) {
      if (type === 'create:deploying' && (step.keep_held_item ?? step.keepHeldItem) === true)
        catalysts.push(stack);
      else inputs.push({ ...stack, count: stack.count * loops });
    }
    duration += positiveNumber(step.processingTime ?? step.processing_time, 0) * loops;
    workstations.push(...workstationStacks(type));
  }
  const weighted = collectFields(raw, OUTPUT_KEYS).filter((stack) => stack.chance > 0);
  const weight = weighted.reduce((sum, stack) => sum + stack.chance, 0);
  if (!weight) return undefined;
  return {
    id: entry.id,
    recipeType: entry.recipeType,
    label: canonicalRecipeLabel(entry.recipeType),
    inputs: mergeStacks(inputs),
    outputs: mergeStacks(weighted.map((stack) => ({ ...stack, chance: stack.chance / weight }))),
    catalysts: mergeStacks(catalysts),
    workstations: [...new Map(workstations.map((stack) => [stack.id, stack])).values()],
    duration,
    energy: 0,
  };
}

function normalizeGregtechRecipe(
  entry: RecipeSnapshotEntry,
  raw: Readonly<Record<string, unknown>>,
): CraftRecipe | undefined {
  const inputs = asRecord(raw.inputs) ?? {};
  const outputs = asRecord(raw.outputs) ?? {};
  const itemInputs = gtContents(inputs.item, 'item');
  const fluidInputs = gtContents(inputs.fluid, 'fluid');
  const itemOutputs = gtContents(outputs.item, 'item');
  const fluidOutputs = gtContents(outputs.fluid, 'fluid');
  if (itemOutputs.length + fluidOutputs.length === 0) return undefined;
  const consumables = [...itemInputs, ...fluidInputs].filter((stack) => stack.chance > 0);
  const catalysts = [...itemInputs, ...fluidInputs].filter((stack) => stack.chance === 0);
  const duration = positiveNumber(raw.duration, 0);
  const tickInputs = asRecord(raw.tickInputs) ?? {};
  const euContent = asRecord(Array.isArray(tickInputs.eu) ? tickInputs.eu[0] : undefined);
  const eu = euContent?.content;
  const euStack = asRecord(eu);
  const eut =
    typeof eu === 'number'
      ? eu
      : positiveNumber(euStack?.voltage, 0) * positiveNumber(euStack?.amperage, 1);
  return {
    id: entry.id,
    recipeType: entry.recipeType,
    label: canonicalRecipeLabel(entry.recipeType),
    inputs: mergeStacks(consumables),
    outputs: mergeStacks([...itemOutputs, ...fluidOutputs]),
    catalysts,
    workstations: workstationStacks(entry.recipeType),
    duration,
    energy: eut * duration,
  };
}

function gtContents(value: unknown, kind: 'item' | 'fluid'): FlowStack[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const wrapper = asRecord(entry);
    const content = asRecord(wrapper?.content);
    if (!content) return [];
    const ingredient = asRecord(content.ingredient);
    const id =
      kind === 'fluid'
        ? (content.fluid ?? content.id ?? ingredient?.fluid ?? ingredient?.id)
        : (ingredient?.item ?? ingredient?.id ?? ingredient?.tag ?? content.item ?? content.id);
    if (typeof id !== 'string' || !isResourceId(id)) return [];
    const rawChance = typeof wrapper?.chance === 'number' ? wrapper.chance : 1;
    const maxChance = positiveNumber(wrapper?.maxChance, rawChance > 1 ? 10000 : 1);
    const chance = maxChance > 0 ? rawChance / maxChance : 1;
    return [
      {
        kind: kind === 'item' && typeof ingredient?.tag === 'string' ? ('tag' as const) : kind,
        id,
        count: positiveNumber(content.count ?? content.amount, 1),
        chance,
      },
    ];
  });
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
      if (output.chance <= 0 || output.count <= 0) continue;
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
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 1;
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
