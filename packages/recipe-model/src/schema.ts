import type { ResourceId } from './index.js';

export type RecipeSchemaFieldKind =
  | 'string'
  | 'resource_id'
  | 'ingredient'
  | 'item_stack'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'enum'
  | 'json';

export interface RecipeSchemaField {
  readonly path: string;
  readonly label: string;
  readonly kind: RecipeSchemaFieldKind;
  readonly description?: string;
  readonly placeholder?: string;
  readonly required: boolean;
  readonly multiple: boolean;
  readonly minItems: number;
  readonly options?: readonly string[];
  readonly default?: unknown;
}

export interface RecipeSchemaDefinition {
  readonly version: 1;
  readonly id: ResourceId;
  readonly label: string;
  readonly recipeType?: ResourceId;
  readonly description?: string;
  readonly fields: readonly RecipeSchemaField[];
}

export interface RecipeSchemaForm {
  readonly recipeId?: string;
  readonly values: Readonly<Record<string, unknown>>;
}

const FIELD_KINDS = new Set<RecipeSchemaFieldKind>([
  'string',
  'resource_id',
  'ingredient',
  'item_stack',
  'number',
  'integer',
  'boolean',
  'enum',
  'json',
]);
const BLOCKED_PATH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);
const RESOURCE_ID = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/u;

export function parseRecipeSchema(input: unknown): RecipeSchemaDefinition {
  const source = objectValue(input, '$');
  if (source.version !== 1) throw new Error('$.version: expected 1');
  const id = resourceId(source.id, '$.id');
  const label = shortText(source.label, '$.label', 80);
  const recipeType =
    source.recipeType === undefined ? undefined : resourceId(source.recipeType, '$.recipeType');
  const description = optionalText(source.description, '$.description', 500);
  if (!Array.isArray(source.fields)) throw new Error('$.fields: expected an array');
  if (source.fields.length === 0) throw new Error('$.fields: add at least one field');
  if (source.fields.length > 100) throw new Error('$.fields: at most 100 fields are allowed');

  const paths = new Set<string>();
  const fields = source.fields.map((value, index) => {
    const path = `$.fields[${index}]`;
    const field = objectValue(value, path);
    const fieldPath = schemaPath(field.path, `${path}.path`);
    if (paths.has(fieldPath)) throw new Error(`${path}.path: duplicate path "${fieldPath}"`);
    paths.add(fieldPath);
    const kind = fieldKind(field.kind, `${path}.kind`);
    if (fieldPath === '$' && kind !== 'json') {
      throw new Error(`${path}.kind: the root "$" field must use json`);
    }
    if (fieldPath === 'type' && kind !== 'resource_id') {
      throw new Error(`${path}.kind: the dynamic recipe type must use resource_id`);
    }
    const multiple = optionalBoolean(field.multiple, `${path}.multiple`, false);
    const required = optionalBoolean(field.required, `${path}.required`, false);
    if (multiple && kind === 'boolean') {
      throw new Error(`${path}.multiple: boolean lists are not supported`);
    }
    if (multiple && fieldPath === '$') {
      throw new Error(`${path}.multiple: the root "$" JSON field cannot be a list`);
    }
    if (multiple && fieldPath === 'type') {
      throw new Error(`${path}.multiple: the dynamic recipe type cannot be a list`);
    }
    const minItems = optionalInteger(field.minItems, `${path}.minItems`, required ? 1 : 0, 0, 100);
    if (!multiple && field.minItems !== undefined) {
      throw new Error(`${path}.minItems: only valid when multiple is true`);
    }
    const options = kind === 'enum' ? enumOptions(field.options, `${path}.options`) : undefined;
    if (kind !== 'enum' && field.options !== undefined) {
      throw new Error(`${path}.options: only valid for enum fields`);
    }
    const fieldDescription = optionalText(field.description, `${path}.description`, 300);
    const placeholder = optionalText(field.placeholder, `${path}.placeholder`, 160);
    const definition: RecipeSchemaField = {
      path: fieldPath,
      label: shortText(field.label, `${path}.label`, 80),
      kind,
      required,
      multiple,
      minItems: multiple ? minItems : 0,
      ...(fieldDescription === undefined ? {} : { description: fieldDescription }),
      ...(placeholder === undefined ? {} : { placeholder }),
      ...(options ? { options } : {}),
      ...(field.default === undefined ? {} : { default: field.default }),
    };
    if (definition.default !== undefined) {
      coerceField(definition, definition.default, `${path}.default`);
    }
    return definition;
  });
  const typeField = fields.find((field) => field.path === 'type');
  if (recipeType && typeField) {
    throw new Error('$.fields: omit the "type" field when recipeType is fixed');
  }
  if (
    !recipeType &&
    (!typeField || !typeField.required || typeField.multiple || typeField.kind !== 'resource_id')
  ) {
    throw new Error(
      '$.fields: schemas without recipeType require a single required resource_id field at "type"',
    );
  }

  return {
    version: 1,
    id,
    label,
    fields,
    ...(recipeType === undefined ? {} : { recipeType }),
    ...(description === undefined ? {} : { description }),
  };
}

export function buildRecipeFromSchema(
  schema: RecipeSchemaDefinition,
  form: RecipeSchemaForm,
): Readonly<Record<string, unknown>> {
  const raw: Record<string, unknown> = {};
  const knownPaths = new Set(schema.fields.map((field) => field.path));
  for (const suppliedPath of Object.keys(form.values)) {
    if (!knownPaths.has(suppliedPath)) {
      throw new Error(`${suppliedPath}: field is not defined by schema ${schema.id}`);
    }
  }
  const prepared = new Map<string, unknown>();
  for (const field of schema.fields) {
    const supplied = form.values[field.path];
    const value = isEmptyValue(supplied) ? field.default : supplied;
    if (isEmptyValue(value)) {
      if (field.required) throw new Error(`${field.label}: value is required`);
      continue;
    }
    const coerced = coerceField(field, value, field.label);
    prepared.set(field.path, coerced);
  }
  const rootValue = prepared.get('$');
  if (rootValue !== undefined) {
    const root = objectValue(rootValue, 'Recipe body');
    for (const [key, entry] of Object.entries(root)) {
      if (key !== 'type') raw[key] = entry;
    }
  }
  for (const [path, value] of prepared) {
    if (path !== '$') setNested(raw, path, value);
  }
  raw.type = schema.recipeType ?? raw.type;
  resourceId(raw.type, 'Recipe type');
  return raw;
}

function coerceField(field: RecipeSchemaField, value: unknown, path: string): unknown {
  if (field.multiple) {
    if (!Array.isArray(value)) throw new Error(`${path}: expected a list`);
    if (value.length < field.minItems) {
      throw new Error(`${path}: add at least ${field.minItems} value(s)`);
    }
    if (value.length > 100) throw new Error(`${path}: at most 100 values are allowed`);
    return value.map((entry, index) => coerceSingle(field, entry, `${path}[${index}]`));
  }
  return coerceSingle(field, value, path);
}

function coerceSingle(field: RecipeSchemaField, value: unknown, path: string): unknown {
  switch (field.kind) {
    case 'string':
      return shortText(value, path, 16_384);
    case 'resource_id':
      return resourceId(value, path);
    case 'ingredient': {
      const text = shortText(value, path, 256);
      return text.startsWith('#')
        ? { tag: resourceId(text.slice(1), path) }
        : { item: resourceId(text, path) };
    }
    case 'item_stack': {
      const text = shortText(value, path, 320);
      const match = /^([a-z0-9_.-]+:[a-z0-9_./-]+)(?:\s*[x*]\s*(\d+))?$/u.exec(text);
      if (!match) throw new Error(`${path}: expected namespace:item or namespace:item x count`);
      const id = resourceId(match[1], path);
      const count = match[2] === undefined ? 1 : Number(match[2]);
      if (!Number.isSafeInteger(count) || count < 1 || count > 2_147_483_647) {
        throw new Error(`${path}: count must be a positive integer`);
      }
      return count === 1 ? { id } : { id, count };
    }
    case 'number': {
      const number = numericValue(value, path);
      if (!Number.isFinite(number)) throw new Error(`${path}: expected a finite number`);
      return number;
    }
    case 'integer': {
      const number = numericValue(value, path);
      if (!Number.isSafeInteger(number)) throw new Error(`${path}: expected a whole number`);
      return number;
    }
    case 'boolean':
      if (typeof value !== 'boolean') throw new Error(`${path}: expected true or false`);
      return value;
    case 'enum': {
      const selected = shortText(value, path, 160);
      if (!field.options?.includes(selected)) {
        throw new Error(`${path}: select one of ${field.options?.join(', ') ?? ''}`);
      }
      return selected;
    }
    case 'json':
      if (typeof value !== 'string') return structuredValue(value, path);
      try {
        return structuredValue(JSON.parse(value) as unknown, path);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`${path}: invalid JSON (${message})`);
      }
  }
}

function setNested(target: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split('.');
  let cursor = target;
  for (const segment of segments.slice(0, -1)) {
    const existing = cursor[segment];
    if (existing === undefined) {
      const next: Record<string, unknown> = {};
      cursor[segment] = next;
      cursor = next;
      continue;
    }
    if (typeof existing !== 'object' || existing === null || Array.isArray(existing)) {
      throw new Error(`${path}: conflicts with another field path`);
    }
    cursor = existing as Record<string, unknown>;
  }
  cursor[segments.at(-1) as string] = value;
}

function schemaPath(value: unknown, path: string): string {
  const text = shortText(value, path, 200);
  if (text === '$') return text;
  const segments = text.split('.');
  if (
    segments.length === 0 ||
    segments.some(
      (segment) => !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(segment) || BLOCKED_PATH_SEGMENTS.has(segment),
    )
  ) {
    throw new Error(`${path}: expected a safe dot-separated object path`);
  }
  if (segments[0] === 'type' && segments.length > 1) {
    throw new Error(`${path}: "type" cannot contain nested fields`);
  }
  return text;
}

function resourceId(value: unknown, path: string): ResourceId {
  if (typeof value !== 'string' || !RESOURCE_ID.test(value)) {
    throw new Error(`${path}: expected a namespaced resource id`);
  }
  return value as ResourceId;
}

function fieldKind(value: unknown, path: string): RecipeSchemaFieldKind {
  if (typeof value !== 'string' || !FIELD_KINDS.has(value as RecipeSchemaFieldKind)) {
    throw new Error(`${path}: unsupported field kind`);
  }
  return value as RecipeSchemaFieldKind;
}

function enumOptions(value: unknown, path: string): readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) {
    throw new Error(`${path}: expected 1 to 100 options`);
  }
  const options = value.map((entry, index) => shortText(entry, `${path}[${index}]`, 160));
  if (new Set(options).size !== options.length) throw new Error(`${path}: options must be unique`);
  return options;
}

function objectValue(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${path}: expected an object`);
  }
  return value as Record<string, unknown>;
}

function structuredValue(value: unknown, path: string): unknown {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new Error('value is not JSON serializable');
    if (serialized.length > 65_536) throw new Error('JSON value exceeds 64 KiB');
    const parsed = JSON.parse(serialized) as unknown;
    validateJsonTree(parsed, path);
    return parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${path}: ${message}`);
  }
}

function validateJsonTree(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => validateJsonTree(entry, `${path}[${index}]`));
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  for (const [key, entry] of Object.entries(value)) {
    if (BLOCKED_PATH_SEGMENTS.has(key)) throw new Error(`${path}: unsafe JSON key "${key}"`);
    validateJsonTree(entry, `${path}.${key}`);
  }
}

function numericValue(value: unknown, path: string): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  throw new Error(`${path}: expected a number`);
}

function optionalBoolean(value: unknown, path: string, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new Error(`${path}: expected true or false`);
  return value;
}

function optionalInteger(
  value: unknown,
  path: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${path}: expected an integer from ${minimum} to ${maximum}`);
  }
  return value as number;
}

function shortText(value: unknown, path: string, maximum: number): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${path}: expected text`);
  }
  const text = value.trim();
  if (text.length > maximum) throw new Error(`${path}: maximum length is ${maximum}`);
  return text;
}

function optionalText(value: unknown, path: string, maximum: number): string | undefined {
  if (value === undefined) return undefined;
  return shortText(value, path, maximum);
}

function isEmptyValue(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === 'string' && value.trim() === '') ||
    (Array.isArray(value) && value.length === 0)
  );
}
