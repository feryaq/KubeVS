import * as vscode from 'vscode';
import { parseRecipeSchema, type RecipeSchemaDefinition } from '@kubevs/recipe-model';
import { parseRecipePack, RECIPE_PACK_MAX_BYTES } from './recipePacks.js';

export interface RecipeSchemaCatalogEntry {
  readonly schema: RecipeSchemaDefinition;
  readonly source: string;
  readonly builtIn: boolean;
  readonly packId?: string;
  readonly packName?: string;
}

export interface RecipeSchemaCatalog {
  readonly entries: readonly RecipeSchemaCatalogEntry[];
  readonly errors: readonly string[];
  readonly directory: string;
}

export interface RecipeSchemaLoadOptions {
  /** Test seam; production callers should omit this. */
  readonly fs?: typeof vscode.workspace.fs;
  /** Test seam; production callers should omit this. */
  readonly workspaceFolders?: readonly vscode.WorkspaceFolder[];
  /** Test seam; production callers should omit this. */
  readonly directory?: string;
}

const MAX_DIRECTORIES = 256;
const MAX_DEPTH = 8;
const MAX_FILES = 200;
const MAX_FILE_BYTES = 256 * 1024;
const PACK_DIRECTORY = '.kubevs/recipe-packs';
const IO_CONCURRENCY = 4;

const RAW_SCHEMA = parseRecipeSchema({
  version: 1,
  id: 'kubevs:raw_custom',
  label: 'Raw Custom Recipe',
  description: 'Use a recipe type and JSON body when no specialized schema is installed.',
  fields: [
    {
      path: 'type',
      label: 'Recipe type',
      kind: 'resource_id',
      required: true,
      placeholder: 'modid:recipe_type',
      description: 'The namespaced serializer ID registered by the target mod.',
    },
    {
      path: '$',
      label: 'Recipe body',
      kind: 'json',
      required: true,
      default: '{}',
      placeholder: '{\n  "ingredients": [],\n  "results": []\n}',
      description: 'JSON fields below type. A type property in this object is ignored.',
    },
  ],
});

export async function loadRecipeSchemas(
  options: RecipeSchemaLoadOptions = {},
): Promise<RecipeSchemaCatalog> {
  const directory = options.directory ?? schemaDirectory();
  const fs = options.fs ?? vscode.workspace.fs;
  const folders = options.workspaceFolders ?? vscode.workspace.workspaceFolders ?? [];
  const entries: RecipeSchemaCatalogEntry[] = [
    { schema: RAW_SCHEMA, source: 'Built in', builtIn: true },
  ];
  const errors: string[] = [];
  const seen = new Set(entries.map((entry) => entry.schema.id));

  const candidates: { uri: vscode.Uri; relative: string; kind: 'schema' | 'pack' }[] = [];
  let scannedDirectories = 0;
  const reportedFileLimits = new Set<'schema' | 'pack'>();
  const roots = folders.flatMap((folder) => [
    {
      uri: vscode.Uri.joinPath(folder.uri, ...directory.split('/')),
      relative: directory,
      kind: 'schema' as const,
    },
    {
      uri: vscode.Uri.joinPath(folder.uri, ...PACK_DIRECTORY.split('/')),
      relative: PACK_DIRECTORY,
      kind: 'pack' as const,
    },
  ]);
  for (const root of roots) {
    if (scannedDirectories >= MAX_DIRECTORIES) {
      errors.push(
        `workspace folders: directory count limit (${MAX_DIRECTORIES}) reached; scan truncated`,
      );
      break;
    }
    const queue: { uri: vscode.Uri; relative: string; depth: number; kind: 'schema' | 'pack' }[] = [
      { ...root, depth: 0 },
    ];
    while (queue.length > 0) {
      const batch = queue.splice(0, IO_CONCURRENCY);
      const results = await Promise.all(
        batch.map(async (current) => {
          try {
            return { current, entries: await fs.readDirectory(current.uri) };
          } catch (error) {
            if (isFileNotFound(error) && current.depth === 0)
              return { current, entries: [] as [string, vscode.FileType][] };
            const message = error instanceof Error ? error.message : String(error);
            errors.push(`${current.relative}: unable to list recipe data directory: ${message}`);
            return { current, entries: [] as [string, vscode.FileType][] };
          }
        }),
      );
      for (const { current, entries } of results) {
        scannedDirectories += 1;
        const sorted = [...entries].sort(([a], [b]) => a.localeCompare(b));
        for (const [name, type] of sorted) {
          if (name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
            errors.push(
              `${current.relative}: ignored unsafe directory entry name ${JSON.stringify(name)}`,
            );
            continue;
          }
          if ((type & vscode.FileType.SymbolicLink) !== 0) continue;
          const relative = `${current.relative}/${name}`;
          const uri = vscode.Uri.joinPath(current.uri, name);
          if ((type & vscode.FileType.Directory) !== 0) {
            if (current.depth >= MAX_DEPTH) {
              errors.push(
                `${relative}: directory depth limit (${MAX_DEPTH}) reached; scan truncated`,
              );
            } else if (scannedDirectories + queue.length < MAX_DIRECTORIES) {
              queue.push({ uri, relative, depth: current.depth + 1, kind: current.kind });
            } else {
              errors.push(
                `${relative}: directory count limit (${MAX_DIRECTORIES}) reached; scan truncated`,
              );
            }
          } else if (
            (type & vscode.FileType.File) !== 0 &&
            ((current.kind === 'schema' && name.endsWith('.recipe-schema.json')) ||
              (current.kind === 'pack' && name.endsWith('.kubevs-pack.json')))
          ) {
            const sameKindCount = candidates.filter(
              (candidate) => candidate.kind === current.kind,
            ).length;
            if (sameKindCount >= MAX_FILES) {
              if (!reportedFileLimits.has(current.kind)) {
                errors.push(
                  `${relative}: ${current.kind} file limit (${MAX_FILES}) reached; additional files ignored`,
                );
                reportedFileLimits.add(current.kind);
              }
              continue;
            }
            candidates.push({ uri, relative, kind: current.kind });
          }
        }
      }
    }
  }

  const schemaCandidates = candidates
    .filter((candidate) => candidate.kind === 'schema')
    .sort((left, right) => left.relative.localeCompare(right.relative));
  const packCandidates = candidates
    .filter((candidate) => candidate.kind === 'pack')
    .sort((left, right) => left.relative.localeCompare(right.relative));
  const readCandidate = async ({ uri, relative }: { uri: vscode.Uri; relative: string }) => {
    try {
      const bytes = await fs.readFile(uri);
      const limit = relative.endsWith('.kubevs-pack.json') ? RECIPE_PACK_MAX_BYTES : MAX_FILE_BYTES;
      if (bytes.byteLength > limit) {
        throw new Error(
          `${relative.endsWith('.kubevs-pack.json') ? 'pack' : 'schema'} exceeds the ${limit / 1024} KiB size limit`,
        );
      }
      return { bytes, relative };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${relative}: ${message}`);
      return undefined;
    }
  };

  // Standalone project schemas deliberately win over schemas contributed by packs.
  for (let offset = 0; offset < schemaCandidates.length; offset += IO_CONCURRENCY) {
    const batch = schemaCandidates.slice(offset, offset + IO_CONCURRENCY);
    const loaded = await Promise.all(
      batch.map(async ({ uri, relative }) => {
        const result = await readCandidate({ uri, relative });
        if (!result) return undefined;
        try {
          const { bytes } = result;
          const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
          const schema = parseRecipeSchema(parsed);
          return { schema, source: relative };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          errors.push(`${relative}: ${message}`);
          return undefined;
        }
      }),
    );
    for (const item of loaded) {
      if (!item) continue;
      if (seen.has(item.schema.id)) {
        errors.push(`${item.source}: duplicate schema id ${item.schema.id}`);
        continue;
      }
      seen.add(item.schema.id);
      entries.push({ ...item, builtIn: false });
    }
  }

  const seenPackIds = new Set<string>();
  for (let offset = 0; offset < packCandidates.length; offset += IO_CONCURRENCY) {
    const batch = packCandidates.slice(offset, offset + IO_CONCURRENCY);
    const loaded = await Promise.all(
      batch.map(async ({ uri, relative }) => {
        const result = await readCandidate({ uri, relative });
        if (!result) return undefined;
        try {
          const pack = parseRecipePack(
            JSON.parse(new TextDecoder().decode(result.bytes)) as unknown,
          );
          return { pack, source: relative };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          errors.push(`${relative}: ${message}`);
          return undefined;
        }
      }),
    );
    for (const item of loaded) {
      if (!item) continue;
      if (seenPackIds.has(item.pack.id)) {
        errors.push(`${item.source}: duplicate recipe pack id ${item.pack.id}`);
        continue;
      }
      seenPackIds.add(item.pack.id);
      for (const schema of item.pack.schemas) {
        if (seen.has(schema.id)) {
          errors.push(
            `${item.source}: duplicate schema id ${schema.id}; existing schema takes precedence`,
          );
          continue;
        }
        seen.add(schema.id);
        entries.push({
          schema,
          source: item.source,
          builtIn: false,
          packId: item.pack.id,
          packName: item.pack.name,
        });
      }
    }
  }

  return {
    directory,
    entries: entries.sort(
      (left, right) =>
        Number(left.builtIn) - Number(right.builtIn) ||
        left.schema.label.localeCompare(right.schema.label),
    ),
    errors,
  };
}

function isFileNotFound(error: unknown): boolean {
  return error instanceof vscode.FileSystemError
    ? error.code === 'FileNotFound'
    : typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'FileNotFound';
}

export function createRecipeSchemaWatcher(callback: () => void): vscode.Disposable {
  const directory = schemaDirectory();
  let disposed = false;
  let watchers: vscode.Disposable[] = [];
  const attach = (): void => {
    for (const watcher of watchers) watcher.dispose();
    watchers = [];
    if (disposed) return;
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      for (const pattern of [
        `${directory}/**/*.recipe-schema.json`,
        `${PACK_DIRECTORY}/**/*.kubevs-pack.json`,
      ]) {
        const watcher = vscode.workspace.createFileSystemWatcher(
          new vscode.RelativePattern(folder, pattern),
        );
        watchers.push(
          watcher,
          watcher.onDidCreate(callback),
          watcher.onDidChange(callback),
          watcher.onDidDelete(callback),
        );
      }
    }
  };
  attach();
  const folderWatcher = vscode.workspace.onDidChangeWorkspaceFolders(() => {
    attach();
    callback();
  });
  return {
    dispose() {
      disposed = true;
      folderWatcher.dispose();
      for (const watcher of watchers) watcher.dispose();
      watchers = [];
    },
  };
}

export function recipeSchemaTemplate(): string {
  return `${JSON.stringify(
    {
      version: 1,
      id: 'my_mod:machine_recipe',
      label: 'My Machine',
      recipeType: 'my_mod:machine',
      description: 'Recipes processed by My Machine.',
      fields: [
        {
          path: 'ingredients',
          label: 'Ingredients',
          kind: 'ingredient',
          required: true,
          multiple: true,
          minItems: 1,
          placeholder: 'minecraft:stone or #c:ingots/iron',
        },
        {
          path: 'results',
          label: 'Results',
          kind: 'item_stack',
          required: true,
          multiple: true,
          minItems: 1,
          placeholder: 'minecraft:diamond x 2',
        },
        {
          path: 'processing_time',
          label: 'Processing time',
          kind: 'integer',
          default: 200,
        },
      ],
    },
    null,
    2,
  )}\n`;
}

export function schemaDirectory(): string {
  const configured = vscode.workspace
    .getConfiguration('kubevs.recipeSchemas')
    .get('directory', '.kubevs/recipe-schemas')
    .trim()
    .replaceAll('\\', '/')
    .replace(/^\/+|\/+$/gu, '');
  if (
    configured.length === 0 ||
    /^[A-Za-z]:/u.test(configured) ||
    configured.split('/').some((segment) => segment === '..')
  ) {
    throw new Error('kubevs.recipeSchemas.directory must be a safe workspace-relative path');
  }
  return configured;
}
