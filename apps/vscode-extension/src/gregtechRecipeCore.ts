/** GTCEu Modern 1.21 KubeJS builder. Keep this separate from JSON recipe writers. */
export interface GregtechOperation {
  readonly op: string;
  readonly item?: string | undefined;
  readonly fluid?: string | undefined;
  readonly amount?: number | undefined;
  readonly count?: number | undefined;
  readonly chance?: number | undefined;
  readonly min?: number | undefined;
  readonly max?: number | undefined;
  readonly tick?: boolean | undefined;
  readonly id?: string | undefined;
  readonly reverse?: boolean | undefined;
  readonly value?: number | boolean | string | undefined;
  readonly key?: string | undefined;
  readonly kind?: string | undefined;
  readonly fluidMaterialInfo?: boolean | undefined;
  readonly ids?: readonly string[] | undefined;
  readonly dataItem?: string | undefined;
  readonly eut?: number | undefined;
  readonly amperage?: number | undefined;
  readonly duration?: number | undefined;
  readonly cwu?: number | undefined;
  readonly totalCwu?: number | undefined;
  readonly fraction?: string | undefined;
  readonly snbt?: string | undefined;
  readonly state?: string | undefined;
}

export const gregtechOperationNames = [
  'itemInput',
  'fluidInput',
  'itemOutput',
  'fluidOutput',
  'itemInputAny',
  'blockInput',
  'blockOutput',
  'steamVent',
  'startupEnergy',
  'cleanroomCondition',
  'addDataSnbt',
  'EUt',
  'inputEU',
  'outputEU',
  'CWUt',
  'inputCWU',
  'outputCWU',
  'totalCWU',
  'addDataString',
  'addDataNumber',
  'addDataBool',
  'explosivesAmount',
  'explosivesType',
  'solderMultiplier',
  'disableDistilleryRecipes',
  'fusionStartEU',
  'researchScan',
  'durationIsTotalCWU',
  'hideDuration',
  'rain',
  'thunder',
  'posY',
  'daytime',
  'nighttime',
  'heraclesQuest',
  'ftbQuest',
  'researchWithoutRecipe',
  'category',
  'chanceLogic',
  'environmentalHazard',
  'addMaterialInfo',
  'removePreviousMaterialInfo',
  'dimension',
  'biome',
  'biomeTag',
  'adjacentFluids',
  'adjacentFluidTag',
  'adjacentBlocks',
  'adjacentBlockTag',
  'scannerResearch',
  'stationResearch',
  'itemInputRanged',
  'itemOutputRanged',
  'fluidInputRanged',
  'fluidOutputRanged',
] as const;

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
  readonly eut?: number | null;
  readonly cleanroom?: 'cleanroom' | 'sterile_cleanroom' | null;
  readonly blastFurnaceTemp?: number | null;
  readonly researchWithoutRecipe?: string | null;
  readonly operations?: readonly GregtechOperation[];
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
    (d.eut === undefined || d.eut === null || typeof d.eut === 'number') &&
    (d.cleanroom === undefined ||
      d.cleanroom === null ||
      d.cleanroom === 'cleanroom' ||
      d.cleanroom === 'sterile_cleanroom') &&
    (d.blastFurnaceTemp === undefined ||
      d.blastFurnaceTemp === null ||
      typeof d.blastFurnaceTemp === 'number') &&
    (d.researchWithoutRecipe === undefined ||
      d.researchWithoutRecipe === null ||
      typeof d.researchWithoutRecipe === 'string') &&
    (d.operations === undefined ||
      (Array.isArray(d.operations) &&
        d.operations.length <= 128 &&
        d.operations.every((v) => v && typeof v === 'object' && typeof v.op === 'string'))) &&
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
  const fluidsIn = draft.fluidInputs.map((v) => fluidStack(v, 'Fluid input', true));
  const outputs = draft.itemOutputs.map((v) => ({
    value: itemStack(v.item, 'Item output', false, v.count),
    chance: chance(v.chance),
  }));
  const fluidsOut = draft.fluidOutputs.map((v) => fluidStack(v, 'Fluid output'));
  const tools = (draft.nonConsumableItems ?? [])
    .map((v) => v.trim())
    .filter(Boolean)
    .map((v) => itemStack(v, 'Reusable item', true));
  const fluidTools = (draft.nonConsumableFluids ?? []).map((v) =>
    fluidStack(v, 'Reusable fluid', true),
  );
  const operations = (draft.operations ?? []).map(compileGregtechOperation);
  if (
    inputs.length + fluidsIn.length + tools.length + fluidTools.length === 0 &&
    !operations.some((v) => v.role === 'input') &&
    !(typeof draft.eut === 'number' && draft.eut > 0)
  )
    throw new Error('Add an item or fluid input.');
  if (
    outputs.length + fluidsOut.length === 0 &&
    !operations.some((v) => v.role === 'output') &&
    !(typeof draft.eut === 'number' && draft.eut < 0)
  )
    throw new Error('Add an item or fluid output.');
  const duration = positive(draft.duration, 'Duration');
  if (
    draft.eut !== undefined &&
    draft.eut !== null &&
    (!Number.isSafeInteger(draft.eut) || draft.eut === 0)
  )
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
  chain.push(`.duration(${duration})`);
  for (const operation of operations) chain.push(...operation.calls);
  if (draft.cleanroom)
    chain.push(
      `.cleanroom(CleanroomType.${draft.cleanroom === 'cleanroom' ? 'CLEANROOM' : 'STERILE_CLEANROOM'})`,
    );
  if (draft.blastFurnaceTemp !== undefined && draft.blastFurnaceTemp !== null)
    chain.push(
      `.blastFurnaceTemp(${positive(draft.blastFurnaceTemp, 'Blast furnace temperature')})`,
    );
  if (draft.researchWithoutRecipe)
    chain.push(
      `.researchWithoutRecipe(${JSON.stringify(requiredString(draft.researchWithoutRecipe, 'Research ID'))})`,
    );
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
  if (draft.eut !== undefined && draft.eut !== null) chain.push(`.EUt(${draft.eut}, 1)`);
  return `ServerEvents.recipes(event => {\n  ${chain.join('\n    ')}\n})\n`;
}

function asResource(value: string, label: string): string {
  const result = value.trim();
  if (!resource.test(result)) throw new Error(`${label}: expected namespace:path.`);
  return result;
}
function positive(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647)
    throw new Error(`${label}: enter a positive Java int (1–2147483647).`);
  return value;
}
function itemStack(value: string, label: string, tags: boolean, count = 1): string {
  const text = value.trim();
  const match = /^(?:(\d+)x\s+)?(#?[a-z0-9_.-]+:[a-z0-9_./-]+)(\[.*\])?$/.exec(text);
  if (!match || (!tags && match[2]?.startsWith('#')))
    throw new Error(`${label}: expected an item ID${tags ? ' or #tag' : ''}.`);
  const quantity = positive(count * Number(match[1] ?? '1'), `${label} count`);
  const id = match[2] ?? '';
  asResource(id.startsWith('#') ? id.slice(1) : id, label);
  return JSON.stringify(`${quantity}x ${id}${match[3] ?? ''}`);
}
function fluidStack(
  value: { readonly fluid: string; readonly amount: number },
  label: string,
  tags = false,
): string {
  const id = value.fluid.trim();
  if (id.startsWith('#') && !tags) throw new Error(`${label}: use a concrete fluid ID for GTCEu.`);
  asResource(id.startsWith('#') ? id.slice(1) : id, label);
  const amount = positive(value.amount, `${label} amount`);
  if (id.startsWith('#'))
    return `Java.loadClass('net.neoforged.neoforge.fluids.crafting.SizedFluidIngredient').of(Java.loadClass('net.minecraft.tags.TagKey').create(Java.loadClass('net.minecraft.core.registries.Registries').FLUID, ${javaLocation(id.slice(1))}), ${amount})`;
  return `Fluid.of(${JSON.stringify(id)}, ${amount})`;
}
function chance(value: number): number {
  if (!Number.isFinite(value) || value <= 0 || value > 1)
    throw new Error('Output chance must be greater than 0 and no more than 1.');
  const scaled = Math.round(value * 10000);
  if (scaled < 1) throw new Error('Output chance is below GTCEu precision (0.01%).');
  return scaled;
}

type CompiledOperation = { calls: string[]; role: 'input' | 'output' | 'other' };

/** Validate the finite, source-verified subset of GTKubeRecipe fluent calls. */
export function validateGregtechOperation(value: unknown): value is GregtechOperation {
  try {
    compileGregtechOperation(value as GregtechOperation);
    return true;
  } catch {
    return false;
  }
}

function compileGregtechOperation(op: GregtechOperation): CompiledOperation {
  if (!op || typeof op !== 'object' || Array.isArray(op))
    throw new Error('GTCEu operation must be an object.');
  const name = op.op;
  if (!gregtechOperationNames.includes(name as (typeof gregtechOperationNames)[number]))
    throw new Error(`Unsupported GTCEu operation: ${String(name)}.`);
  const allowed: Record<string, readonly string[]> = {
    itemInput: ['item', 'count', 'chance', 'tick'],
    fluidInput: ['fluid', 'amount', 'chance', 'tick'],
    itemOutput: ['item', 'count', 'chance', 'fraction', 'tick'],
    fluidOutput: ['fluid', 'amount', 'chance', 'fraction', 'tick'],
    EUt: ['value', 'amount'],
    inputEU: ['value', 'amount', 'tick'],
    outputEU: ['value', 'amount', 'tick'],
    itemInputAny: ['ids', 'count', 'tick'],
    blockInput: ['state', 'tick'],
    blockOutput: ['state', 'tick'],
    steamVent: ['reverse'],
    startupEnergy: ['value', 'reverse'],
    cleanroomCondition: ['id', 'reverse'],
    addDataSnbt: ['key', 'snbt'],
    CWUt: ['value'],
    inputCWU: ['value', 'tick'],
    outputCWU: ['value', 'tick'],
    totalCWU: ['value'],
    addDataString: ['key', 'value'],
    addDataNumber: ['key', 'value'],
    addDataBool: ['key', 'value'],
    explosivesAmount: ['value'],
    explosivesType: ['item', 'count'],
    solderMultiplier: ['value'],
    disableDistilleryRecipes: ['value'],
    fusionStartEU: ['value'],
    researchScan: ['value'],
    durationIsTotalCWU: ['value'],
    hideDuration: ['value'],
    rain: ['value', 'reverse'],
    thunder: ['value', 'reverse'],
    posY: ['min', 'max', 'reverse'],
    daytime: ['value'],
    nighttime: [],
    heraclesQuest: ['id', 'reverse'],
    ftbQuest: ['id', 'reverse'],
    researchWithoutRecipe: ['id', 'dataItem'],
    category: ['id'],
    chanceLogic: ['kind', 'id', 'key'],
    environmentalHazard: ['id', 'reverse'],
    addMaterialInfo: ['value', 'fluidMaterialInfo'],
    removePreviousMaterialInfo: [],
    dimension: ['id', 'reverse'],
    biome: ['id', 'reverse'],
    biomeTag: ['id', 'reverse'],
    adjacentFluids: ['ids', 'reverse'],
    adjacentFluidTag: ['ids', 'reverse'],
    adjacentBlocks: ['ids', 'reverse'],
    adjacentBlockTag: ['ids', 'reverse'],
    scannerResearch: ['id', 'item', 'fluid', 'amount', 'dataItem', 'duration', 'eut', 'amperage'],
    stationResearch: [
      'id',
      'item',
      'fluid',
      'amount',
      'dataItem',
      'cwu',
      'totalCwu',
      'eut',
      'amperage',
    ],
    itemInputRanged: ['item', 'min', 'max', 'tick'],
    itemOutputRanged: ['item', 'min', 'max', 'tick'],
    fluidInputRanged: ['fluid', 'min', 'max', 'tick'],
    fluidOutputRanged: ['fluid', 'min', 'max', 'tick'],
  };
  for (const key of Object.keys(op))
    if (key !== 'op' && !allowed[name]?.includes(key))
      throw new Error(`${name}: unsupported property ${key}.`);
  const result = (call: string, role: CompiledOperation['role'] = 'other'): CompiledOperation => ({
    calls:
      op.tick === undefined
        ? [call]
        : [`.perTick(${bool(op.tick, 'perTick')})`, call, '.perTick(false)'],
    role,
  });
  if (name === 'startupEnergy')
    return result(
      `.addCondition(new (Java.loadClass('com.gregtechceu.gtceu.common.recipe.condition.EUToStartCondition'))(${bool(op.reverse ?? false, 'reverse')}, ${positiveLong(op.value, 'Startup EU')}))`,
    );
  if (name === 'cleanroomCondition') {
    if (op.id !== 'cleanroom' && op.id !== 'sterile_cleanroom')
      throw new Error('Cleanroom must be cleanroom or sterile_cleanroom.');
    return result(
      `.addCondition(new (Java.loadClass('com.gregtechceu.gtceu.common.recipe.condition.CleanroomCondition'))(${bool(op.reverse ?? false, 'reverse')}, CleanroomType.${op.id === 'cleanroom' ? 'CLEANROOM' : 'STERILE_CLEANROOM'}))`,
    );
  }
  if (name === 'steamVent')
    return result(
      `.addCondition(new (Java.loadClass('com.gregtechceu.gtceu.common.recipe.condition.VentCondition'))(${bool(op.reverse ?? false, 'reverse')}))`,
    );
  if (name === 'addDataSnbt')
    return result(
      `.addData(${JSON.stringify(requiredString(op.key, 'Data key'))}, Java.loadClass('net.minecraft.nbt.TagParser').parseTag(${JSON.stringify(requiredString(op.snbt, 'Compound SNBT'))}))`,
    );
  if (name === 'itemInputAny') {
    if (!Array.isArray(op.ids) || op.ids.length < 1 || op.ids.length > 32)
      throw new Error('Alternative items: enter 1–32 IDs or #tags.');
    const ids = op.ids.map((id) => {
      const text = requiredString(id, 'Alternative item');
      asResource(text.startsWith('#') ? text.slice(1) : text, 'Alternative item');
      return text;
    });
    return result(
      `.itemInputs(Ingredient.of(${JSON.stringify(ids)}, ${positive(op.count ?? 1, 'Alternative item count')}))`,
      'input',
    );
  }
  if (name === 'blockInput' || name === 'blockOutput') {
    const state = requiredString(op.state, 'Block state');
    if (!/^([a-z0-9_.-]+:[a-z0-9_./-]+)(?:\[[a-z0-9_=,.-]+\])?$/.test(state))
      throw new Error('Block state: expected namespace:block[property=value].');
    return result(
      `.${name === 'blockInput' ? 'input' : 'output'}('gtceu:block_state', Java.loadClass('net.minecraft.commands.arguments.blocks.BlockStateParser').parseForBlock(Java.loadClass('net.minecraft.core.registries.BuiltInRegistries').BLOCK.asLookup(), ${JSON.stringify(state)}, false).blockState())`,
      name === 'blockInput' ? 'input' : 'output',
    );
  }
  if (name === 'itemInput' || name === 'itemOutput') {
    const item = itemStack(
      requiredString(op.item, `${name} item`),
      `${name} item`,
      name === 'itemInput',
      op.count ?? 1,
    );
    const role = name === 'itemInput' ? 'input' : 'output';
    if (op.fraction !== undefined) {
      if (op.chance !== undefined) throw new Error('Choose either chance or fraction.');
      return result(`.chancedOutput(${item}, ${JSON.stringify(validFraction(op.fraction))})`, role);
    }
    if (name === 'itemInput' && op.chance === 0) return result(`.notConsumableItem(${item})`, role);
    if (op.chance !== undefined) {
      const scaled = chance(op.chance);
      return result(
        `.${name === 'itemInput' ? 'chancedInput' : 'chancedOutput'}(${item}, ${scaled})`,
        role,
      );
    }
    return result(`.${name === 'itemInput' ? 'itemInputs' : 'itemOutputs'}(${item})`, role);
  }
  if (name === 'fluidInput' || name === 'fluidOutput') {
    const fluid = fluidStack(
      {
        fluid: requiredString(op.fluid, `${name} fluid`),
        amount: positive(op.amount as number, `${name} amount`),
      },
      `${name} fluid`,
      name === 'fluidInput',
    );
    const role = name === 'fluidInput' ? 'input' : 'output';
    if (op.fraction !== undefined) {
      if (op.chance !== undefined) throw new Error('Choose either chance or fraction.');
      return result(
        `.chancedFluidOutput(${fluid}, ${JSON.stringify(validFraction(op.fraction))})`,
        role,
      );
    }
    if (name === 'fluidInput' && op.chance === 0)
      return result(`.notConsumableFluid(${fluid})`, role);
    if (op.chance !== undefined) {
      const scaled = chance(op.chance);
      return result(
        `.${name === 'fluidInput' ? 'chancedFluidInput' : 'chancedFluidOutput'}(${fluid}, ${scaled})`,
        role,
      );
    }
    return result(`.${name === 'fluidInput' ? 'inputFluids' : 'outputFluids'}(${fluid})`, role);
  }
  if (name === 'EUt' || name === 'inputEU' || name === 'outputEU') {
    if (typeof op.value !== 'number' || !Number.isSafeInteger(op.value) || op.value === 0)
      throw new Error(`${name}: voltage must be a nonzero integer.`);
    const amperage = positive(op.amount ?? 1, `${name} amperage`);
    if (name !== 'EUt' && (op.value as number) < 0)
      throw new Error('Explicit inputEU/outputEU voltage must be positive.');
    return result(
      `.${name}(${op.value}, ${amperage})`,
      name === 'inputEU' || (name === 'EUt' && (op.value as number) > 0) ? 'input' : 'output',
    );
  }
  if (name === 'CWUt') {
    if (
      typeof op.value !== 'number' ||
      !Number.isSafeInteger(op.value) ||
      op.value === 0 ||
      Math.abs(op.value) > 2_147_483_647
    )
      throw new Error('CWUt must be a nonzero Java int.');
    return result(`.CWUt(${op.value})`, (op.value as number) > 0 ? 'input' : 'output');
  }
  if (name.endsWith('Ranged')) {
    const min = nonnegative(op.min as number, `${name} minimum`);
    const max = positive(op.max as number, `${name} maximum`);
    if (min > max) throw new Error(`${name}: minimum exceeds maximum.`);
    const input = name.includes('Input');
    const role = input ? 'input' : 'output';
    if (name.startsWith('item')) {
      const text = requiredString(op.item, `${name} item`);
      const id = asResource(text.startsWith('#') ? text.slice(1) : text, `${name} item`);
      const location = javaLocation(id);
      const ingredient = text.startsWith('#')
        ? `Java.loadClass('net.minecraft.world.item.crafting.Ingredient').of(Java.loadClass('net.minecraft.tags.TagKey').create(Java.loadClass('net.minecraft.core.registries.Registries').ITEM, ${location}))`
        : `Java.loadClass('net.minecraft.world.item.crafting.Ingredient').of(Java.loadClass('net.minecraft.core.registries.BuiltInRegistries').ITEM.get(${location}))`;
      return result(
        `.${input ? 'inputItemsRanged' : 'outputItemsRanged'}(${ingredient}, ${min}, ${max})`,
        role,
      );
    }
    const id = asResource(requiredString(op.fluid, `${name} fluid`), `${name} fluid`);
    const stack = `Fluid.of(${JSON.stringify(id)}, 1)`;
    return result(
      `.${input ? 'inputFluidsRanged' : 'outputFluidsRanged'}(${input ? stack : `Java.loadClass('net.neoforged.neoforge.fluids.crafting.FluidIngredient').of(${stack})`}, ${min}, ${max})`,
      role,
    );
  }
  if (name === 'inputCWU' || name === 'outputCWU' || name === 'totalCWU')
    return result(
      `.${name}(${positive(op.value as number, name)})`,
      name === 'inputCWU' ? 'input' : name === 'outputCWU' ? 'output' : 'other',
    );
  if (name === 'addDataString')
    return result(
      `.addDataString(${JSON.stringify(requiredString(op.key, 'Data key'))}, ${JSON.stringify(requiredString(op.value, 'Data value'))})`,
    );
  if (name === 'addDataNumber') {
    if (typeof op.value !== 'number' || !Number.isFinite(op.value))
      throw new Error('Data number must be finite.');
    return result(
      `.addDataNumber(${JSON.stringify(requiredString(op.key, 'Data key'))}, ${op.value})`,
    );
  }
  if (name === 'addDataBool')
    return result(
      `.addDataBool(${JSON.stringify(requiredString(op.key, 'Data key'))}, ${bool(op.value, 'Data boolean')})`,
    );
  if (name === 'explosivesAmount' || name === 'solderMultiplier')
    return result(
      `.${name}(${positive(op.value as number, name)})`,
      name === 'explosivesAmount' ? 'input' : 'other',
    );
  if (name === 'explosivesType')
    return result(
      `.explosivesType(${itemStack(requiredString(op.item, 'Explosives type'), 'Explosives type', false, op.count ?? 1)})`,
      'input',
    );
  if (name === 'fusionStartEU')
    return result(`.fusionStartEU(${positiveLong(op.value, 'Fusion startup EU')})`);
  if (
    ['disableDistilleryRecipes', 'researchScan', 'durationIsTotalCWU', 'hideDuration'].includes(
      name,
    )
  )
    return result(`.${name}(${bool(op.value, name)})`);
  if (name === 'rain' || name === 'thunder') {
    if (typeof op.value !== 'number' || !Number.isFinite(op.value) || op.value < 0 || op.value > 1)
      throw new Error(`${name}: level must be 0–1.`);
    return result(`.${name}(${op.value}, ${bool(op.reverse ?? false, 'reverse')})`);
  }
  if (name === 'posY') {
    const min = boundedY(op.min, 'minimum Y');
    const max = boundedY(op.max, 'maximum Y');
    if (min > max) throw new Error('Y minimum exceeds maximum.');
    return result(`.posY(${min}, ${max}, ${bool(op.reverse ?? false, 'reverse')})`);
  }
  if (name === 'daytime') return result(`.daytime(${bool(op.value ?? false, 'daytime')})`);
  if (name === 'nighttime') return result('.nighttime()');
  if (name === 'heraclesQuest' || name === 'ftbQuest') {
    const id = requiredString(op.id, `${name} ID`);
    if (name === 'ftbQuest' && (!/^[0-9a-fA-F]{1,16}$/.test(id) || /^0+$/.test(id)))
      throw new Error('FTB quest ID must be a nonzero hexadecimal code of up to 16 digits.');
    return result(`.${name}(${JSON.stringify(id)}, ${bool(op.reverse ?? false, 'reverse')})`);
  }
  if (name === 'researchWithoutRecipe')
    return result(
      `.researchWithoutRecipe(${JSON.stringify(requiredString(op.id, 'Research ID'))}${op.dataItem ? `, Item.of(${JSON.stringify(asResource(op.dataItem, 'Data item'))})` : ''})`,
    );
  if (name === 'scannerResearch' || name === 'stationResearch') {
    if (!op.item && !op.fluid) throw new Error(`${name}: add a research item or fluid.`);
    const steps: string[] = [];
    if (op.item)
      steps.push(
        `.researchStack(Item.of(${JSON.stringify(asResource(op.item, 'Research item'))}))`,
      );
    if (op.fluid)
      steps.push(
        `.researchFluidStack(${fluidStack({ fluid: op.fluid, amount: positive(op.amount as number, 'Research fluid amount') }, 'Research fluid')})`,
      );
    if (op.id) steps.push(`.researchId(${JSON.stringify(requiredString(op.id, 'Research ID'))})`);
    if (op.dataItem)
      steps.push(`.dataStack(Item.of(${JSON.stringify(asResource(op.dataItem, 'Data item'))}))`);
    if (op.eut !== undefined) {
      if (!Number.isSafeInteger(op.eut) || op.eut <= 0)
        throw new Error('Research EU/t must be a positive integer.');
      steps.push(`.EUt(${op.eut}, ${positive(op.amperage ?? 1, 'Research amperage')})`);
    } else if (op.amperage !== undefined) throw new Error('Research amperage requires EU/t.');
    if (name === 'scannerResearch' && op.duration !== undefined)
      steps.push(`.duration(${positive(op.duration, 'Scanner duration')})`);
    if (name === 'stationResearch') {
      const cwu = positive(op.cwu as number, 'Station CWU/t');
      const total = positive(op.totalCwu as number, 'Station total CWU');
      if (total < cwu) throw new Error('Station total CWU must be at least CWU/t.');
      steps.push(`.CWUt(${cwu}, ${total})`);
    }
    const method =
      name === 'scannerResearch'
        ? '["scannerResearch(java.util.function.UnaryOperator)"]'
        : '.stationResearch';
    return result(`${method}(b => b${steps.join('')})`);
  }
  if (name === 'category')
    return result(
      `.category(${JSON.stringify(asResource(requiredString(op.id, 'GT recipe category'), 'GT recipe category'))})`,
    );
  if (name === 'chanceLogic') {
    const kind = requiredString(op.kind, 'Chance logic kind');
    const logic = JSON.stringify(
      asResource(requiredString(op.id, 'Chance logic ID'), 'Chance logic ID'),
    );
    const direct: Record<string, string> = {
      itemInput: 'chancedItemInputLogic',
      fluidInput: 'chancedFluidInputLogic',
      itemOutput: 'chancedItemOutputLogic',
      fluidOutput: 'chancedFluidOutputLogic',
    };
    if (direct[kind]) return result(`.${direct[kind]}(${logic})`);
    const method =
      kind === 'tickInput'
        ? 'chancedTickInputLogic'
        : kind === 'tickOutput'
          ? 'chancedTickOutputLogic'
          : null;
    if (!method)
      throw new Error(
        'Chance logic kind must be itemInput, fluidInput, itemOutput, fluidOutput, tickInput, or tickOutput.',
      );
    const capability = JSON.stringify(
      asResource(requiredString(op.key, 'Recipe capability ID'), 'Recipe capability ID'),
    );
    return result(`.${method}(${capability}, ${logic})`);
  }
  if (name === 'environmentalHazard')
    return result(
      `.environmentalHazard(${JSON.stringify(asResource(requiredString(op.id, 'Medical condition ID'), 'Medical condition ID'))}, ${bool(op.reverse ?? false, 'reverse')})`,
    );
  if (name === 'addMaterialInfo')
    return result(
      `.addMaterialInfo(${bool(op.value, 'Item material info')}, ${bool(op.fluidMaterialInfo ?? false, 'Fluid material info')})`,
    );
  if (name === 'removePreviousMaterialInfo') return result('.removePreviousMaterialInfo()');
  if (name === 'dimension' || name === 'biome' || name === 'biomeTag') {
    const id = javaLocation(asResource(requiredString(op.id, `${name} ID`), `${name} ID`));
    const registry = `Java.loadClass('net.minecraft.core.registries.Registries').${name === 'dimension' ? 'DIMENSION' : 'BIOME'}`;
    const type =
      name === 'biomeTag' ? 'net.minecraft.tags.TagKey' : 'net.minecraft.resources.ResourceKey';
    return result(
      `.${name}(Java.loadClass('${type}').create(${registry}, ${id}), ${bool(op.reverse ?? false, 'reverse')})`,
    );
  }
  if (['adjacentFluids', 'adjacentFluidTag', 'adjacentBlocks', 'adjacentBlockTag'].includes(name)) {
    if (!Array.isArray(op.ids) || op.ids.length < 1 || op.ids.length > 32)
      throw new Error(`${name}: enter 1–32 resource IDs.`);
    const values = op.ids.map((id) =>
      javaLocation(asResource(requiredString(id, `${name} ID`), `${name} ID`)),
    );
    const tags = name.endsWith('Tag');
    const fluid = name.includes('Fluid');
    const registry = fluid ? 'FLUID' : 'BLOCK';
    const expressions = values.map((value) =>
      tags
        ? `Java.loadClass('net.minecraft.tags.TagKey').create(Java.loadClass('net.minecraft.core.registries.Registries').${registry}, ${value})`
        : `Java.loadClass('net.minecraft.core.registries.BuiltInRegistries').${registry}.get(${value})`,
    );
    const args = tags ? `[${expressions.join(', ')}]` : expressions.join(', ');
    return result(`.${name}(${bool(op.reverse ?? false, 'reverse')}, ${args})`);
  }
  throw new Error(`Unsupported GTCEu operation: ${name}.`);
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 300)
    throw new Error(`${label}: enter a nonempty string of at most 300 characters.`);
  return value.trim();
}
function bool(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label}: expected true or false.`);
  return value;
}
function boundedY(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < -2048 || value > 2048)
    throw new Error(`${label}: expected an integer from -2048 to 2048.`);
  return value;
}
function javaLocation(id: string): string {
  return `Java.loadClass('net.minecraft.resources.ResourceLocation').parse(${JSON.stringify(id)})`;
}
function validFraction(value: string): string {
  const match = /^(\d+)\/(\d+)$/.exec(value);
  if (!match) throw new Error('Chance fraction must be numerator/denominator.');
  const numerator = Number(match[1]);
  const denominator = Number(match[2]);
  if (
    !Number.isSafeInteger(numerator) ||
    !Number.isSafeInteger(denominator) ||
    numerator < 1 ||
    numerator >= denominator ||
    denominator > 10_000
  )
    throw new Error('Chance fraction requires 0 < numerator < denominator ≤ 10000.');
  return `${numerator}/${denominator}`;
}

function nonnegative(value: number, label: string): number {
  if (value === 0) return 0;
  return positive(value, label);
}
function positiveLong(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0)
    throw new Error(`${label}: enter a positive safe integer.`);
  return value;
}

export interface GregtechShapedDraft {
  readonly recipeId: string;
  readonly pattern: readonly string[];
  readonly key: Readonly<Record<string, string>>;
  readonly output: string;
  readonly count: number;
  readonly mirrored?: boolean;
  readonly addMaterialInfo?: boolean;
}

/** GT shaped crafting reserves lower-case symbols for reusable tools. */
export function generateGregtechShapedRecipe(draft: GregtechShapedDraft): string {
  const id = asResource(draft.recipeId, 'Recipe ID');
  const output = itemStack(draft.output, 'Output', false, draft.count);
  const tools = new Set('shrwfcdmxk');
  if (
    !Array.isArray(draft.pattern) ||
    !draft.pattern.length ||
    draft.pattern.length > 3 ||
    !draft.pattern[0]?.length ||
    draft.pattern[0].length > 3 ||
    draft.pattern.some(
      (row) =>
        typeof row !== 'string' ||
        row.length !== draft.pattern[0]?.length ||
        !/^[A-Za-z0-9 ]+$/.test(row),
    ) ||
    !draft.pattern.join('').trim()
  )
    throw new Error('GT crafting requires a nonempty rectangular grid, at most 3×3.');
  if (!draft.key || typeof draft.key !== 'object' || Array.isArray(draft.key))
    throw new Error('Invalid GT crafting ingredient keys.');
  const key: Record<string, string> = {};
  for (const symbol of new Set(draft.pattern.join('').replaceAll(' ', ''))) {
    if (tools.has(symbol)) continue;
    const ingredient = draft.key[symbol];
    if (typeof ingredient !== 'string') throw new Error(`Ingredient ${symbol} is missing.`);
    itemStack(ingredient, `Ingredient ${symbol}`, true);
    key[symbol] = ingredient;
  }
  return `ServerEvents.recipes(event => {\n  event.recipes.gtceu.shaped(${output}, ${JSON.stringify(draft.pattern)}, ${JSON.stringify(key)})\n    .id(${JSON.stringify(id)})${draft.mirrored === false ? '\n    .noMirror()' : ''}${draft.addMaterialInfo ? '\n    .addMaterialInfo()' : ''}\n})\n`;
}
