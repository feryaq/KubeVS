/** GTCEu Modern 1.21 KubeJS builder. Keep this separate from JSON recipe writers. */
export interface GregtechRecipeDraft {
  readonly machine: string;
  readonly recipeId: string;
  readonly itemInputs: readonly string[];
  readonly fluidInputs: readonly { readonly fluid: string; readonly amount: number }[];
  readonly itemOutputs: readonly {
    readonly item: string;
    readonly count: number;
    readonly chance: number;
  }[];
  readonly fluidOutputs: readonly { readonly fluid: string; readonly amount: number }[];
  readonly nonConsumableItems?: readonly string[];
  readonly nonConsumableFluids?: readonly { readonly fluid: string; readonly amount: number }[];
  readonly circuit?: number | null;
  readonly duration: number;
  readonly eut: number;
  /** Optional 1.21 GTKubeRecipe condition: posY(min, max). */
  readonly posY?: { readonly min: number; readonly max: number } | null;
}

const resource = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/;
const machine = /^[a-z0-9_]+$/;
const MAX_ROWS = 64;

export function isGregtechRecipeDraft(value: unknown): value is GregtechRecipeDraft {
  if (!value || typeof value !== 'object') return false;
  const d = value as Partial<GregtechRecipeDraft>;
  const items = (list: unknown): boolean =>
    Array.isArray(list) &&
    list.length <= MAX_ROWS &&
    list.every((v) => typeof v === 'string' && v.length <= 300);
  const fluids = (list: unknown): boolean =>
    Array.isArray(list) &&
    list.length <= MAX_ROWS &&
    list.every(
      (v) =>
        v &&
        typeof v === 'object' &&
        typeof v.fluid === 'string' &&
        v.fluid.length <= 300 &&
        typeof v.amount === 'number',
    );
  return (
    typeof d.machine === 'string' &&
    d.machine.length <= 80 &&
    typeof d.recipeId === 'string' &&
    d.recipeId.length <= 300 &&
    items(d.itemInputs) &&
    fluids(d.fluidInputs) &&
    Array.isArray(d.itemOutputs) &&
    d.itemOutputs.length <= MAX_ROWS &&
    d.itemOutputs.every(
      (v) =>
        v &&
        typeof v.item === 'string' &&
        v.item.length <= 300 &&
        typeof v.count === 'number' &&
        typeof v.chance === 'number',
    ) &&
    fluids(d.fluidOutputs) &&
    (d.nonConsumableItems === undefined || items(d.nonConsumableItems)) &&
    (d.nonConsumableFluids === undefined || fluids(d.nonConsumableFluids)) &&
    (d.circuit === undefined || d.circuit === null || typeof d.circuit === 'number') &&
    typeof d.duration === 'number' &&
    typeof d.eut === 'number' &&
    (d.posY === undefined ||
      d.posY === null ||
      (typeof d.posY.min === 'number' && typeof d.posY.max === 'number'))
  );
}

export function generateGregtechRecipe(draft: GregtechRecipeDraft): string {
  if (!isGregtechRecipeDraft(draft)) throw new Error('Invalid GregTech recipe model.');
  const kind = draft.machine.trim();
  if (!machine.test(kind))
    throw new Error(
      'Machine type: use the GTCEu recipe type path (lowercase letters, digits, underscores).',
    );
  const id = asResource(draft.recipeId, 'Recipe ID');
  const inputs = draft.itemInputs
    .map((v) => v.trim())
    .filter(Boolean)
    .map((v) => itemStack(v, 'Item input', true));
  const fluidsIn = draft.fluidInputs.map((v) => fluidStack(v, 'Fluid input'));
  const outputs = draft.itemOutputs.map((v) => ({
    value: itemStack(v.item, 'Item output', false, v.count),
    chance: chance(v.chance),
  }));
  const fluidsOut = draft.fluidOutputs.map((v) => fluidStack(v, 'Fluid output'));
  const tools = (draft.nonConsumableItems ?? [])
    .map((v) => v.trim())
    .filter(Boolean)
    .map((v) => itemStack(v, 'Reusable item', true));
  const fluidTools = (draft.nonConsumableFluids ?? []).map((v) => fluidStack(v, 'Reusable fluid'));
  if (inputs.length + fluidsIn.length + tools.length + fluidTools.length === 0)
    throw new Error('Add an item or fluid input.');
  if (outputs.length + fluidsOut.length === 0) throw new Error('Add an item or fluid output.');
  const duration = positive(draft.duration, 'Duration');
  if (!Number.isSafeInteger(draft.eut) || draft.eut === 0)
    throw new Error('EU/t must be a nonzero integer. Use a negative value for generators.');
  const chain: string[] = [`event.recipes.gtceu.${kind}(${JSON.stringify(id)})`];
  for (const input of inputs) chain.push(`.itemInputs(${input})`);
  for (const input of fluidsIn) chain.push(`.inputFluids(${input})`);
  for (const input of tools) chain.push(`.notConsumableItem(${input})`);
  for (const input of fluidTools) chain.push(`.notConsumableFluid(${input})`);
  if (draft.circuit !== undefined && draft.circuit !== null) {
    if (!Number.isInteger(draft.circuit) || draft.circuit < 0 || draft.circuit > 32)
      throw new Error('Circuit configuration must be 0–32.');
    chain.push(`.circuit(${draft.circuit})`);
  }
  for (const output of outputs)
    chain.push(
      output.chance === 10000
        ? `.itemOutputs(${output.value})`
        : `.chancedOutput(${output.value}, ${output.chance})`,
    );
  for (const output of fluidsOut) chain.push(`.outputFluids(${output})`);
  if (draft.posY) {
    const { min, max } = draft.posY;
    if (
      !Number.isSafeInteger(min) ||
      !Number.isSafeInteger(max) ||
      min > max ||
      min < -2048 ||
      max > 2048
    )
      throw new Error('Y range: enter valid integer bounds from -2048 to 2048.');
    chain.push(`.posY(${min}, ${max})`);
  }
  chain.push(`.duration(${duration})`, `.EUt(${draft.eut}, 1)`);
  return `ServerEvents.recipes(event => {\n  ${chain.join('\n    ')}\n})\n`;
}

function asResource(value: string, label: string): string {
  const result = value.trim();
  if (!resource.test(result)) throw new Error(`${label}: expected namespace:path.`);
  return result;
}
function positive(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error(`${label}: enter a positive integer.`);
  return value;
}
function itemStack(value: string, label: string, tags: boolean, count = 1): string {
  const text = value.trim();
  const match = /^(?:(\d+)x\s+)?(#?[a-z0-9_.-]+:[a-z0-9_./-]+)$/.exec(text);
  if (!match || (!tags && match[2]?.startsWith('#')))
    throw new Error(`${label}: expected an item ID${tags ? ' or #tag' : ''}.`);
  const quantity = positive(count * Number(match[1] ?? '1'), `${label} count`);
  const id = match[2] ?? '';
  asResource(id.startsWith('#') ? id.slice(1) : id, label);
  return JSON.stringify(`${quantity}x ${id}`);
}
function fluidStack(
  value: { readonly fluid: string; readonly amount: number },
  label: string,
): string {
  const id = value.fluid.trim();
  if (id.startsWith('#')) throw new Error(`${label}: use a concrete fluid ID for GTCEu.`);
  asResource(id.startsWith('#') ? id.slice(1) : id, label);
  return `Fluid.of(${JSON.stringify(id)}, ${positive(value.amount, `${label} amount`)})`;
}
function chance(value: number): number {
  if (!Number.isFinite(value) || value <= 0 || value > 1)
    throw new Error('Output chance must be greater than 0 and no more than 1.');
  const scaled = Math.round(value * 10000);
  if (scaled < 1) throw new Error('Output chance is below GTCEu precision (0.01%).');
  return scaled;
}
