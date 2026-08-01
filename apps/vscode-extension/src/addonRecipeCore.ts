export type AddonRecipeType =
  | 'create:pressing'
  | 'create:crushing'
  | 'create:milling'
  | 'create:mixing'
  | 'create:compacting'
  | 'create:cutting'
  | 'create:deploying'
  | 'create:sequenced_assembly'
  | 'oritech:assembler'
  | 'oritech:pulverizer'
  | 'oritech:grinder'
  | 'oritech:centrifuge'
  | 'oritech:foundry'
  | 'oritech:atomic_forge'
  | 'farmersdelight:cooking'
  | 'farmersdelight:cutting';

export type CreateSequenceStepType = 'create:pressing' | 'create:deploying' | 'create:cutting';

export interface AddonRecipeOutput {
  readonly item: string;
  readonly count: number;
  readonly chance: number;
}

export interface AddonRecipeFluidStack {
  readonly fluid: string;
  /** Amount in millibuckets (mB). */
  readonly amount: number;
}

export interface CreateSequenceStep {
  readonly type: CreateSequenceStepType;
  readonly ingredient: string;
}

export interface AddonRecipeDraft {
  readonly type: AddonRecipeType;
  readonly recipeId: string;
  readonly ingredients: readonly string[];
  readonly fluidInputs: readonly AddonRecipeFluidStack[];
  readonly outputs: readonly AddonRecipeOutput[];
  readonly fluidOutputs: readonly AddonRecipeFluidStack[];
  readonly processingTime: number;
  readonly experience: number;
  readonly heat: 'none' | 'heated' | 'superheated';
  readonly loops: number;
  readonly transitionalItem: string;
  readonly tool: string;
  readonly sequence: readonly CreateSequenceStep[];
}

const RESOURCE_LOCATION = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/;
const RECIPE_TYPES = new Set<AddonRecipeType>([
  'create:pressing',
  'create:crushing',
  'create:milling',
  'create:mixing',
  'create:compacting',
  'create:cutting',
  'create:deploying',
  'create:sequenced_assembly',
  'oritech:assembler',
  'oritech:pulverizer',
  'oritech:grinder',
  'oritech:centrifuge',
  'oritech:foundry',
  'oritech:atomic_forge',
  'farmersdelight:cooking',
  'farmersdelight:cutting',
]);

export function generateAddonRecipe(draft: AddonRecipeDraft): string {
  validateDraftShape(draft);
  const recipeId = requireResource(draft.recipeId, 'ID рецепта');
  const ingredients = draft.ingredients
    .map((ingredient) => ingredient.trim())
    .filter(Boolean)
    .map(parseIngredient);
  const fluidInputs = draft.fluidInputs.map(parseFluidIngredient);
  const fluidOutputs = draft.fluidOutputs.map(parseFluidOutput);
  if (ingredients.length + fluidInputs.length === 0) {
    throw new Error('Добавьте хотя бы один предметный или жидкостный вход.');
  }
  if (draft.outputs.length + fluidOutputs.length === 0) {
    throw new Error('Добавьте хотя бы один предметный или жидкостный результат.');
  }
  const outputs = draft.outputs.map(parseOutput);
  const firstIngredient = ingredients.at(0);
  const firstOutput = outputs.at(0);
  validateFluidSupport(draft.type, fluidInputs.length, fluidOutputs.length);
  validateMachineLimits(draft.type, ingredients.length, outputs.length);

  let recipe: Record<string, unknown>;
  if (draft.type === 'create:sequenced_assembly') {
    if (!firstIngredient || outputs.length === 0) {
      throw new Error('Последовательной сборке нужны предметный вход и предметный результат.');
    }
    recipe = createSequencedAssembly(draft, firstIngredient, outputs);
  } else if (draft.type === 'farmersdelight:cooking') {
    if (!firstOutput) throw new Error('Готовке в котле нужен предметный результат.');
    recipe = {
      type: draft.type,
      ingredients,
      result: stripChance(firstOutput),
      experience: nonNegative(draft.experience, 'Опыт'),
      cookingtime: positiveInteger(draft.processingTime, 'Время приготовления'),
      recipe_book_tab: 'meals',
    };
  } else if (draft.type === 'farmersdelight:cutting') {
    recipe = {
      type: draft.type,
      ingredients: [firstIngredient],
      tool: [parseIngredient(draft.tool || '#minecraft:tools')],
      result: outputs.map((output) => ({ item: stripChance(output) })),
    };
  } else {
    recipe = {
      type: draft.type,
      ingredients: [...ingredients, ...fluidInputs],
      results: [...outputs, ...fluidOutputs],
    };
    if (draft.type.startsWith('oritech:')) {
      recipe.time = positiveInteger(draft.processingTime, 'Время обработки');
    }
    if (
      draft.type === 'create:crushing' ||
      draft.type === 'create:milling' ||
      draft.type === 'create:cutting'
    ) {
      recipe.processing_time = positiveInteger(draft.processingTime, 'Время обработки');
    }
    if (
      draft.heat !== 'none' &&
      (draft.type === 'create:mixing' || draft.type === 'create:compacting')
    ) {
      recipe.heat_requirement = draft.heat;
    }
  }

  const json = JSON.stringify(recipe, null, 2);
  return `ServerEvents.recipes(event => {\n  event.custom(${indent(json, 2)}).id(${JSON.stringify(recipeId)})\n})\n`;
}

export function isAddonRecipeDraft(value: unknown): value is AddonRecipeDraft {
  if (typeof value !== 'object' || value === null) return false;
  const draft = value as Partial<AddonRecipeDraft>;
  return (
    typeof draft.type === 'string' &&
    RECIPE_TYPES.has(draft.type as AddonRecipeType) &&
    typeof draft.recipeId === 'string' &&
    draft.recipeId.length <= 300 &&
    Array.isArray(draft.ingredients) &&
    draft.ingredients.length <= 64 &&
    draft.ingredients.every(
      (ingredient) => typeof ingredient === 'string' && ingredient.length <= 300,
    ) &&
    isFluidStackList(draft.fluidInputs) &&
    Array.isArray(draft.outputs) &&
    draft.outputs.length <= 64 &&
    draft.outputs.every(
      (output) =>
        typeof output === 'object' &&
        output !== null &&
        typeof (output as Partial<AddonRecipeOutput>).item === 'string' &&
        ((output as Partial<AddonRecipeOutput>).item?.length ?? 301) <= 300 &&
        typeof (output as Partial<AddonRecipeOutput>).count === 'number' &&
        typeof (output as Partial<AddonRecipeOutput>).chance === 'number',
    ) &&
    isFluidStackList(draft.fluidOutputs) &&
    typeof draft.processingTime === 'number' &&
    typeof draft.experience === 'number' &&
    (draft.heat === 'none' || draft.heat === 'heated' || draft.heat === 'superheated') &&
    typeof draft.loops === 'number' &&
    typeof draft.transitionalItem === 'string' &&
    draft.transitionalItem.length <= 300 &&
    typeof draft.tool === 'string' &&
    draft.tool.length <= 300 &&
    Array.isArray(draft.sequence) &&
    draft.sequence.length <= 64 &&
    draft.sequence.every(
      (step) =>
        typeof step === 'object' &&
        step !== null &&
        ((step as Partial<CreateSequenceStep>).type === 'create:pressing' ||
          (step as Partial<CreateSequenceStep>).type === 'create:deploying' ||
          (step as Partial<CreateSequenceStep>).type === 'create:cutting') &&
        typeof (step as Partial<CreateSequenceStep>).ingredient === 'string' &&
        ((step as Partial<CreateSequenceStep>).ingredient?.length ?? 301) <= 300,
    )
  );
}

function validateDraftShape(draft: AddonRecipeDraft): void {
  if (!isAddonRecipeDraft(draft)) {
    throw new Error('Редактор передал повреждённую или неподдерживаемую модель рецепта.');
  }
}

function validateMachineLimits(
  type: AddonRecipeType,
  ingredientCount: number,
  outputCount: number,
): void {
  const singleInput = new Set<AddonRecipeType>([
    'create:pressing',
    'create:crushing',
    'create:milling',
    'create:cutting',
    'create:sequenced_assembly',
    'farmersdelight:cutting',
  ]);
  const singleOutput = new Set<AddonRecipeType>([
    'create:pressing',
    'create:milling',
    'create:cutting',
    'create:deploying',
    'farmersdelight:cooking',
  ]);
  if (singleInput.has(type) && ingredientCount !== 1) {
    throw new Error('Выбранная машина принимает ровно один входной ингредиент.');
  }
  if (type === 'create:deploying' && ingredientCount !== 2) {
    throw new Error('Установка Create требует основной предмет и устанавливаемый ингредиент.');
  }
  if (singleOutput.has(type) && outputCount !== 1) {
    throw new Error('Выбранная машина создаёт ровно один результат.');
  }
}

function validateFluidSupport(
  type: AddonRecipeType,
  fluidInputCount: number,
  fluidOutputCount: number,
): void {
  if (
    fluidInputCount + fluidOutputCount > 0 &&
    type !== 'create:mixing' &&
    type !== 'create:compacting'
  ) {
    throw new Error(
      'Жидкости в этом редакторе поддерживаются для механического смешивания и прессования в бассейне.',
    );
  }
}

function createSequencedAssembly(
  draft: AddonRecipeDraft,
  ingredient: Record<string, unknown>,
  outputs: readonly Record<string, unknown>[],
): Record<string, unknown> {
  const transitional = requireResource(draft.transitionalItem, 'Переходный предмет');
  const sequence = draft.sequence.map((step, index) => {
    if (
      step.type !== 'create:pressing' &&
      step.type !== 'create:deploying' &&
      step.type !== 'create:cutting'
    ) {
      throw new Error(`Шаг ${index + 1}: неподдерживаемая операция.`);
    }
    const stepIngredients: Record<string, unknown>[] = [{ item: transitional }];
    if (step.type === 'create:deploying') {
      if (!step.ingredient.trim()) {
        throw new Error(`Шаг ${index + 1}: для установки нужен дополнительный ингредиент.`);
      }
      stepIngredients.push(parseIngredient(step.ingredient));
    }
    return {
      type: step.type,
      ingredients: stepIngredients,
      results: [{ id: transitional }],
    };
  });
  if (sequence.length === 0) throw new Error('Добавьте хотя бы один шаг сборки.');
  return {
    type: draft.type,
    ingredient,
    transitional_item: { id: transitional },
    sequence,
    results: outputs,
    loops: positiveInteger(draft.loops, 'Количество циклов'),
  };
}

function parseIngredient(value: string): Record<string, unknown> {
  const trimmed = value.trim();
  if (trimmed.startsWith('#')) {
    return { tag: requireResource(trimmed.slice(1), 'Тег ингредиента') };
  }
  return { item: requireResource(trimmed, 'Ингредиент') };
}

function parseOutput(output: AddonRecipeOutput): Record<string, unknown> {
  const result: Record<string, unknown> = {
    id: requireResource(output.item, 'Результат'),
  };
  const count = positiveInteger(output.count, 'Количество результата');
  if (count !== 1) result.count = count;
  if (!Number.isFinite(output.chance) || output.chance <= 0) {
    throw new Error('Шанс или вес результата должен быть больше нуля.');
  }
  if (output.chance !== 1) result.chance = output.chance;
  return result;
}

function parseFluidIngredient(stack: AddonRecipeFluidStack): Record<string, unknown> {
  const amount = positiveInteger(stack.amount, 'Объём жидкостного входа');
  const value = stack.fluid.trim();
  if (value.startsWith('#')) {
    return {
      type: 'neoforge:tag',
      amount,
      tag: requireResource(value.slice(1), 'Тег жидкости'),
    };
  }
  return {
    type: 'neoforge:single',
    amount,
    fluid: requireResource(value, 'Жидкость'),
  };
}

function parseFluidOutput(stack: AddonRecipeFluidStack): Record<string, unknown> {
  if (stack.fluid.trim().startsWith('#')) {
    throw new Error('Жидкостный результат должен указывать конкретную жидкость, а не тег.');
  }
  return {
    amount: positiveInteger(stack.amount, 'Объём жидкостного результата'),
    id: requireResource(stack.fluid, 'Жидкостный результат'),
  };
}

function isFluidStackList(value: unknown): value is readonly AddonRecipeFluidStack[] {
  return (
    Array.isArray(value) &&
    value.length <= 64 &&
    value.every(
      (stack) =>
        typeof stack === 'object' &&
        stack !== null &&
        typeof (stack as Partial<AddonRecipeFluidStack>).fluid === 'string' &&
        ((stack as Partial<AddonRecipeFluidStack>).fluid?.length ?? 301) <= 300 &&
        typeof (stack as Partial<AddonRecipeFluidStack>).amount === 'number',
    )
  );
}

function stripChance(output: Record<string, unknown>): Record<string, unknown> {
  const result = { ...output };
  delete result.chance;
  return result;
}

function requireResource(value: string, label: string): string {
  const trimmed = value.trim();
  if (!RESOURCE_LOCATION.test(trimmed)) {
    throw new Error(`${label}: ожидается ID вида namespace:path.`);
  }
  return trimmed;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label}: укажите целое число больше нуля.`);
  }
  return value;
}

function nonNegative(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label}: значение не может быть отрицательным.`);
  }
  return value;
}

function indent(value: string, spaces: number): string {
  const prefix = ' '.repeat(spaces);
  return value
    .split('\n')
    .map((line, index) => (index === 0 ? line : `${prefix}${line}`))
    .join('\n');
}
