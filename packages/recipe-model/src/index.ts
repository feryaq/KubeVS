export type ResourceId = `${string}:${string}`;

export {
  buildRecipeFromSchema,
  parseRecipeSchema,
  type RecipeSchemaDefinition,
  type RecipeSchemaField,
  type RecipeSchemaFieldKind,
  type RecipeSchemaForm,
} from './schema.js';

export type Ingredient =
  | { readonly kind: 'item'; readonly id: ResourceId }
  | { readonly kind: 'tag'; readonly id: ResourceId }
  | { readonly kind: 'alternatives'; readonly options: readonly Ingredient[] };

export interface ItemStack {
  readonly id: ResourceId;
  readonly count: number;
  readonly components?: Readonly<Record<string, unknown>>;
}

interface RecipeBase {
  readonly id?: ResourceId;
  readonly recipeType: ResourceId;
}

export interface ShapedRecipe extends RecipeBase {
  readonly kind: 'vanilla_shaped';
  readonly recipeType: 'minecraft:crafting_shaped';
  readonly pattern: readonly string[];
  readonly key: Readonly<Record<string, Ingredient>>;
  readonly result: ItemStack;
}

export interface ShapelessRecipe extends RecipeBase {
  readonly kind: 'vanilla_shapeless';
  readonly recipeType: 'minecraft:crafting_shapeless';
  readonly ingredients: readonly Ingredient[];
  readonly result: ItemStack;
}

export interface CookingRecipe extends RecipeBase {
  readonly kind: 'vanilla_cooking';
  readonly recipeType:
    | 'minecraft:smelting'
    | 'minecraft:blasting'
    | 'minecraft:smoking'
    | 'minecraft:campfire_cooking';
  readonly ingredient: Ingredient;
  readonly result: ItemStack;
  readonly experience: number;
  readonly cookingTime: number;
}

export interface GenericRecipe extends RecipeBase {
  readonly kind: 'generic';
  readonly raw: Readonly<Record<string, unknown>>;
}

export type RecipeDocument = ShapedRecipe | ShapelessRecipe | CookingRecipe | GenericRecipe;

export interface ImportIssue {
  readonly path: string;
  readonly message: string;
  readonly severity: 'warning' | 'error';
}

export interface ImportResult {
  readonly recipe: RecipeDocument;
  readonly issues: readonly ImportIssue[];
}

const COOKING_TYPES = new Set([
  'minecraft:smelting',
  'minecraft:blasting',
  'minecraft:smoking',
  'minecraft:campfire_cooking',
]);

export function importRecipeJson(id: string | undefined, input: unknown): ImportResult {
  const raw = record(input, '$');
  const recipeType = resourceId(raw.type, '$.type');
  const recipeId = id === undefined ? undefined : resourceId(id, 'id');
  const issues: ImportIssue[] = [];

  if (recipeType === 'minecraft:crafting_shaped') {
    const pattern = stringArray(raw.pattern, '$.pattern');
    const keyRecord = record(raw.key, '$.key');
    const key = Object.fromEntries(
      Object.entries(keyRecord).map(([symbol, value]) => {
        if (symbol.length !== 1) throw new Error(`$.key.${symbol}: key must be one character`);
        return [symbol, ingredient(value, `$.key.${symbol}`)];
      }),
    );
    for (const symbol of new Set(pattern.join(''))) {
      if (symbol !== ' ' && !key[symbol]) {
        issues.push({
          path: '$.pattern',
          message: `Pattern uses "${symbol}" without an ingredient mapping.`,
          severity: 'error',
        });
      }
    }
    return {
      recipe: optionalId(
        {
          kind: 'vanilla_shaped',
          recipeType,
          pattern,
          key,
          result: itemStack(raw.result, '$.result'),
        },
        recipeId,
      ),
      issues,
    };
  }

  if (recipeType === 'minecraft:crafting_shapeless') {
    const ingredients = array(raw.ingredients, '$.ingredients').map((value, index) =>
      ingredient(value, `$.ingredients[${index}]`),
    );
    return {
      recipe: optionalId(
        {
          kind: 'vanilla_shapeless',
          recipeType,
          ingredients,
          result: itemStack(raw.result, '$.result'),
        },
        recipeId,
      ),
      issues,
    };
  }

  if (COOKING_TYPES.has(recipeType)) {
    const result = itemStack(raw.result, '$.result');
    return {
      recipe: optionalId(
        {
          kind: 'vanilla_cooking',
          recipeType: recipeType as CookingRecipe['recipeType'],
          ingredient: ingredient(raw.ingredient, '$.ingredient'),
          result,
          experience: finiteNumber(raw.experience ?? 0, '$.experience'),
          cookingTime: positiveInteger(
            raw.cookingtime ?? defaultCookingTime(recipeType),
            '$.cookingtime',
          ),
        },
        recipeId,
      ),
      issues,
    };
  }

  issues.push({
    path: '$.type',
    message: `No specialized editor is registered for ${recipeType}; raw fields were preserved.`,
    severity: 'warning',
  });
  return {
    recipe: optionalId({ kind: 'generic', recipeType, raw }, recipeId),
    issues,
  };
}

export function generateKubeJs(recipe: RecipeDocument): string {
  let expression: string;
  switch (recipe.kind) {
    case 'vanilla_shaped':
      expression = `event.shaped(${stackCode(recipe.result)}, ${pretty(recipe.pattern)}, ${pretty(
        Object.fromEntries(
          Object.entries(recipe.key).map(([symbol, value]) => [symbol, ingredientCode(value)]),
        ),
      )})`;
      break;
    case 'vanilla_shapeless':
      expression = `event.shapeless(${stackCode(recipe.result)}, ${pretty(
        recipe.ingredients.map(ingredientCode),
      )})`;
      break;
    case 'vanilla_cooking': {
      if (recipe.recipeType === 'minecraft:campfire_cooking') {
        expression = `event.campfireCooking(${stackCode(recipe.result)}, ${ingredientLiteral(
          recipe.ingredient,
        )}, ${recipe.experience}, ${recipe.cookingTime})`;
      } else {
        const method = recipe.recipeType.slice('minecraft:'.length);
        expression = `event.${method}(${stackCode(recipe.result)}, ${ingredientLiteral(
          recipe.ingredient,
        )}).xp(${recipe.experience}).cookingTime(${recipe.cookingTime})`;
      }
      break;
    }
    case 'generic':
      expression = `event.custom(${pretty(recipe.raw)})`;
      break;
  }
  return `${expression}${recipe.id ? `.id(${quote(recipe.id)})` : ''}`;
}

function ingredient(value: unknown, path: string): Ingredient {
  if (Array.isArray(value)) {
    if (value.length === 0) throw new Error(`${path}: alternatives cannot be empty`);
    return {
      kind: 'alternatives',
      options: value.map((entry, index) => ingredient(entry, `${path}[${index}]`)),
    };
  }
  if (typeof value === 'string') {
    return value.startsWith('#')
      ? { kind: 'tag', id: resourceId(value.slice(1), path) }
      : { kind: 'item', id: resourceId(value, path) };
  }
  const object = record(value, path);
  if (typeof object.tag === 'string')
    return { kind: 'tag', id: resourceId(object.tag, `${path}.tag`) };
  if (typeof object.item === 'string')
    return { kind: 'item', id: resourceId(object.item, `${path}.item`) };
  throw new Error(`${path}: expected an item, tag, or alternatives`);
}

function itemStack(value: unknown, path: string): ItemStack {
  if (typeof value === 'string') return { id: resourceId(value, path), count: 1 };
  const object = record(value, path);
  const id = resourceId(object.id ?? object.item, `${path}.id`);
  const count = positiveInteger(object.count ?? 1, `${path}.count`);
  const components =
    object.components === undefined ? undefined : record(object.components, `${path}.components`);
  return components ? { id, count, components } : { id, count };
}

function ingredientCode(value: Ingredient): string | readonly string[] {
  switch (value.kind) {
    case 'item':
      return value.id;
    case 'tag':
      return `#${value.id}`;
    case 'alternatives':
      return value.options.map((option) => {
        const generated = ingredientCode(option);
        if (typeof generated !== 'string')
          throw new Error('Nested ingredient alternatives are not supported');
        return generated;
      });
  }
}

function ingredientLiteral(value: Ingredient): string {
  const generated = ingredientCode(value);
  return typeof generated === 'string' ? quote(generated) : pretty(generated);
}

function stackCode(stack: ItemStack): string {
  if (stack.count === 1 && !stack.components) return quote(stack.id);
  const components = stack.components ? `, ${pretty(stack.components)}` : '';
  return `Item.of(${quote(stack.id)}, ${stack.count}${components})`;
}

function optionalId<T extends RecipeBase>(recipe: T, id: ResourceId | undefined): T {
  return id ? { ...recipe, id } : recipe;
}

function resourceId(value: unknown, path: string): ResourceId {
  if (typeof value !== 'string' || !/^[a-z0-9_.-]+:[a-z0-9_./-]+$/u.test(value)) {
    throw new Error(`${path}: expected a namespaced resource id`);
  }
  return value as ResourceId;
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${path}: expected an object`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${path}: expected an array`);
  return value;
}

function stringArray(value: unknown, path: string): readonly string[] {
  const values = array(value, path);
  if (!values.every((entry) => typeof entry === 'string'))
    throw new Error(`${path}: expected strings`);
  return values as readonly string[];
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error(`${path}: expected a finite number`);
  return value;
}

function positiveInteger(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${path}: expected a positive integer`);
  }
  return value;
}

function defaultCookingTime(recipeType: string): number {
  return recipeType === 'minecraft:campfire_cooking'
    ? 600
    : recipeType === 'minecraft:smelting'
      ? 200
      : 100;
}

function quote(value: string): string {
  return JSON.stringify(value);
}

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
