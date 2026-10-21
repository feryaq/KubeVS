import type { ResourceId } from './index.js';
import {
  buildRecipeFromSchema,
  parseRecipeSchema,
  type RecipeSchemaDefinition,
  type RecipeSchemaField,
} from './schema.js';

export interface InferRecipeSchemaFromJsonInput {
  readonly id: ResourceId;
  readonly label: string;
  readonly json: unknown;
}

/**
 * Builds a conservative editable schema around an existing recipe. All recipe
 * data is retained in `base`; only fields with lossless scalar editors are
 * surfaced individually. Arrays and richer values stay editable as JSON.
 */
export function inferRecipeSchemaFromJson(
  input: InferRecipeSchemaFromJsonInput,
): RecipeSchemaDefinition {
  const recipe = record(input.json, 'Recipe JSON');
  const recipeType = resourceId(recipe.type, 'Recipe JSON.type');
  const fields: RecipeSchemaField[] = [];

  for (const [key, value] of Object.entries(recipe)) {
    if (key === 'type') continue;
    inferValueFields(value, key, fields);
  }

  if (fields.length === 0) {
    fields.push({
      path: '$',
      label: 'Recipe JSON',
      kind: 'json',
      required: true,
      multiple: false,
      minItems: 0,
      default: recipe,
    });
  }

  const schema = parseRecipeSchema({
    version: 1,
    id: input.id,
    label: input.label,
    recipeType,
    base: recipe,
    fields,
  });
  if (jsonEqual(buildRecipeFromSchema(schema, { values: {} }), recipe)) return schema;

  // A root JSON editor is the final safety net if a future coercer changes in
  // a way that makes any inferred defaults lossy.
  return parseRecipeSchema({
    version: 1,
    id: input.id,
    label: input.label,
    recipeType,
    base: recipe,
    fields: [
      {
        path: '$',
        label: 'Recipe JSON',
        kind: 'json',
        required: true,
        multiple: false,
        minItems: 0,
        default: recipe,
      },
    ],
  });
}

function inferValueFields(value: unknown, path: string, fields: RecipeSchemaField[]): void {
  if (!safePath(path)) return;
  if (Array.isArray(value)) {
    const inferredList = inferList(value);
    if (inferredList) {
      fields.push({
        path,
        label: path.split('.').map(humanize).join(' · '),
        kind: inferredList.kind,
        required: false,
        multiple: true,
        minItems: 0,
        default: inferredList.values,
      });
      return;
    }
    fields.push(jsonField(path, value));
    return;
  }
  if (typeof value === 'string') {
    const kind =
      /(?:^|\.)(?:id|item|fluid|tag)$/iu.test(path) && isResourceId(value)
        ? 'resource_id'
        : 'string';
    fields.push(scalarField(path, value, kind));
    return;
  }
  if (typeof value === 'boolean') {
    fields.push(scalarField(path, value, 'boolean'));
    return;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    fields.push(scalarField(path, value, Number.isSafeInteger(value) ? 'integer' : 'number'));
    return;
  }
  if (isRecord(value)) {
    const ingredient = plainIngredientObject(value);
    if (ingredient !== undefined) {
      fields.push(scalarField(path, ingredient, 'ingredient'));
      return;
    }
    const stack = plainItemStack(value);
    if (stack !== undefined) {
      fields.push(scalarField(path, stack, 'item_stack'));
      return;
    }
    if (isExtendedItemStack(value)) {
      fields.push(jsonField(path, value));
      return;
    }
    for (const [key, entry] of Object.entries(value)) {
      inferValueFields(entry, `${path}.${key}`, fields);
    }
    return;
  }
  fields.push(jsonField(path, value));
}

function inferList(
  values: readonly unknown[],
): { kind: RecipeSchemaField['kind']; values: readonly string[] } | undefined {
  if (values.length === 0) return undefined;
  if (values.every((value): value is string => typeof value === 'string')) {
    return {
      kind: values.every(isResourceId) ? 'resource_id' : 'string',
      values,
    };
  }

  const ingredientShapes = values.map((value) =>
    isRecord(value) ? Object.keys(value).sort().join(',') : '',
  );
  const ingredients = values.map((value) =>
    isRecord(value) ? plainIngredientObject(value) : undefined,
  );
  if (
    ingredientShapes.every((shape) => shape === ingredientShapes[0]) &&
    ingredients.every((value): value is string => value !== undefined)
  ) {
    return { kind: 'ingredient', values: ingredients };
  }

  const stacks = values.map((value) => (isRecord(value) ? plainItemStack(value) : undefined));
  if (stacks.every((value): value is string => value !== undefined)) {
    return { kind: 'item_stack', values: stacks };
  }
  return undefined;
}

function plainIngredientObject(value: Record<string, unknown>): string | undefined {
  const keys = Object.keys(value);
  if (keys.length !== 1) return undefined;
  if (keys[0] === 'item' && typeof value.item === 'string' && isResourceId(value.item)) {
    return value.item;
  }
  if (keys[0] === 'tag' && typeof value.tag === 'string' && isResourceId(value.tag)) {
    return `#${value.tag}`;
  }
  return undefined;
}

function plainItemStack(value: Record<string, unknown>): string | undefined {
  const keys = Object.keys(value);
  if (!keys.every((key) => key === 'id' || key === 'count') || !keys.includes('id')) {
    return undefined;
  }
  if (typeof value.id !== 'string' || !isResourceId(value.id)) return undefined;
  if (value.count === undefined) return value.id;
  if (!Number.isSafeInteger(value.count) || (value.count as number) < 2) return undefined;
  return `${value.id} x ${value.count as number}`;
}

function isExtendedItemStack(value: Record<string, unknown>): boolean {
  return (
    typeof value.id === 'string' && ('count' in value || 'components' in value || 'chance' in value)
  );
}

function jsonField(path: string, value: unknown): RecipeSchemaField {
  return {
    path,
    label: path.split('.').map(humanize).join(' · '),
    kind: 'json',
    required: false,
    multiple: false,
    minItems: 0,
    default: value,
  };
}

function scalarField(
  path: string,
  value: string | number | boolean,
  kind: RecipeSchemaField['kind'],
): RecipeSchemaField {
  return {
    path,
    label: path.split('.').map(humanize).join(' · '),
    kind,
    required: false,
    multiple: false,
    minItems: 0,
    default: value,
  };
}

function humanize(value: string): string {
  return value.replace(/[_-]+/gu, ' ').replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
}

function safePath(path: string): boolean {
  return path
    .split('.')
    .every(
      (segment) =>
        /^[A-Za-z_][A-Za-z0-9_]*$/u.test(segment) &&
        !['__proto__', 'prototype', 'constructor'].includes(segment),
    );
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${path}: expected an object`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isResourceId(value: string): value is ResourceId {
  return /^[a-z0-9_.-]+:[a-z0-9_./-]+$/u.test(value);
}

function resourceId(value: unknown, path: string): ResourceId {
  if (typeof value !== 'string' || !isResourceId(value)) {
    throw new Error(`${path}: expected a namespaced resource id`);
  }
  return value;
}

function jsonEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((entry, index) => jsonEqual(entry, right[index]))
    );
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) => key === rightKeys[index] && jsonEqual(left[key], right[key]))
  );
}
