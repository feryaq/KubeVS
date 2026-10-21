import { createHash } from 'node:crypto';
import { parseRecipeSchema, type RecipeSchemaDefinition } from '@kubevs/recipe-model';

export interface RecipePack {
  readonly format: 'kubevs-recipe-pack';
  readonly version: 1;
  readonly id: string;
  readonly name: string;
  readonly schemas: readonly RecipeSchemaDefinition[];
}

export const RECIPE_PACK_FORMAT = 'kubevs-recipe-pack' as const;
export const RECIPE_PACK_VERSION = 1 as const;
export const RECIPE_PACK_MAX_BYTES = 1024 * 1024;
export const RECIPE_PACK_MAX_SCHEMAS = 100;

const RESOURCE_ID = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/u;
const PACK_KEYS = new Set(['format', 'version', 'id', 'name', 'schemas']);

/** Parse and normalize a data-only pack. Packs contain schema data, never executable code. */
export function parseRecipePack(input: unknown): RecipePack {
  let encoded: string | undefined;
  try {
    encoded = JSON.stringify(input);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`recipe pack is not JSON serializable (${message})`);
  }
  if (encoded === undefined) throw new Error('recipe pack is not JSON serializable');
  if (new TextEncoder().encode(encoded).byteLength > RECIPE_PACK_MAX_BYTES) {
    throw new Error(`recipe pack exceeds the ${RECIPE_PACK_MAX_BYTES / 1024} KiB size limit`);
  }
  const source = objectValue(input, '$');
  for (const key of Object.keys(source)) {
    if (!PACK_KEYS.has(key)) throw new Error(`$.${key}: unknown pack property`);
  }
  if (source.format !== RECIPE_PACK_FORMAT) {
    throw new Error(`$.format: expected "${RECIPE_PACK_FORMAT}"`);
  }
  if (source.version !== RECIPE_PACK_VERSION) throw new Error('$.version: expected 1');
  const id = resourceId(source.id, '$.id');
  recipePackFileName(id);
  const name = text(source.name, '$.name', 80);
  if (!Array.isArray(source.schemas)) throw new Error('$.schemas: expected an array');
  if (source.schemas.length === 0) throw new Error('$.schemas: add at least one schema');
  if (source.schemas.length > RECIPE_PACK_MAX_SCHEMAS) {
    throw new Error(`$.schemas: at most ${RECIPE_PACK_MAX_SCHEMAS} schemas are allowed`);
  }
  const schemas = source.schemas.map((value, index) => {
    try {
      return parseRecipeSchema(value);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`$.schemas[${index}]: ${message}`);
    }
  });
  const seen = new Set<string>();
  for (const schema of schemas) {
    if (seen.has(schema.id)) throw new Error(`$.schemas: duplicate schema id ${schema.id}`);
    seen.add(schema.id);
  }
  return { format: RECIPE_PACK_FORMAT, version: RECIPE_PACK_VERSION, id, name, schemas };
}

/** Serialize a validated pack using the canonical v1 manifest shape. */
export function serializeRecipePack(input: RecipePack | unknown): string {
  const pack = parseRecipePack(input);
  const serialized = `${JSON.stringify(pack, null, 2)}\n`;
  if (new TextEncoder().encode(serialized).byteLength > RECIPE_PACK_MAX_BYTES) {
    throw new Error(`recipe pack exceeds the ${RECIPE_PACK_MAX_BYTES / 1024} KiB size limit`);
  }
  return serialized;
}

/** Return a stable single-segment filename, bounding long encoded IDs on all platforms. */
export function recipePackFileName(id: string): string {
  if (!RESOURCE_ID.test(id)) throw new Error('recipe pack id must be a namespaced resource ID');
  if (id.length > 200) throw new Error('recipe pack id is too long (maximum 200 characters)');
  const encoded = encodeURIComponent(id);
  const name =
    encoded.length <= 220
      ? encoded
      : `${encoded.slice(0, 150)}~${createHash('sha256').update(id).digest('hex')}`;
  return `${name}.kubevs-pack.json`;
}

function objectValue(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${path}: expected an object`);
  }
  return value as Record<string, unknown>;
}

function resourceId(value: unknown, path: string): string {
  if (typeof value !== 'string' || !RESOURCE_ID.test(value)) {
    throw new Error(`${path}: expected a namespaced resource ID`);
  }
  return value;
}

function text(value: unknown, path: string, maximum: number): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximum) {
    throw new Error(`${path}: expected non-empty text of at most ${maximum} characters`);
  }
  return value.trim();
}
