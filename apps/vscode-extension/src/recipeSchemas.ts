import * as vscode from 'vscode';
import { parseRecipeSchema, type RecipeSchemaDefinition } from '@kubevs/recipe-model';

export interface RecipeSchemaCatalogEntry {
  readonly schema: RecipeSchemaDefinition;
  readonly source: string;
  readonly builtIn: boolean;
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

  const candidates: { uri: vscode.Uri; relative: string }[] = [];
  let scannedDirectories = 0;
  let fileLimitReported = false;
  for (const folder of folders) {
    if (scannedDirectories >= MAX_DIRECTORIES) {
      errors.push(
        `workspace folders: directory count limit (${MAX_DIRECTORIES}) reached; scan truncated`,
      );
      break;
    }
    const root = vscode.Uri.joinPath(folder.uri, ...directory.split('/'));
    const queue: { uri: vscode.Uri; relative: string; depth: number }[] = [
      { uri: root, relative: directory, depth: 0 },
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
            errors.push(`${current.relative}: unable to list schema directory: ${message}`);
            return { current, entries: [] as [string, vscode.FileType][] };
          }
        }),
      );
      for (const { current, entries } of results) {
        scannedDirectories += 1;
        const sorted = [...entries].sort(([a], [b]) => a.localeCompare(b));
        for (const [name, type] of sorted) {
          if ((type & vscode.FileType.SymbolicLink) !== 0) continue;
          const relative = `${current.relative}/${name}`;
          const uri = vscode.Uri.joinPath(current.uri, name);
          if ((type & vscode.FileType.Directory) !== 0) {
            if (current.depth >= MAX_DEPTH) {
              errors.push(
                `${relative}: directory depth limit (${MAX_DEPTH}) reached; scan truncated`,
              );
            } else if (scannedDirectories + queue.length < MAX_DIRECTORIES) {
              queue.push({ uri, relative, depth: current.depth + 1 });
            } else {
              errors.push(
                `${relative}: directory count limit (${MAX_DIRECTORIES}) reached; scan truncated`,
              );
            }
          } else if ((type & vscode.FileType.File) !== 0 && name.endsWith('.recipe-schema.json')) {
            if (candidates.length >= MAX_FILES) {
              if (!fileLimitReported) {
                errors.push(
                  `${relative}: schema file limit (${MAX_FILES}) reached; scan truncated`,
                );
                fileLimitReported = true;
              }
              queue.length = 0;
              break;
            }
            candidates.push({ uri, relative });
          }
        }
      }
    }
  }

  candidates.sort((left, right) => left.relative.localeCompare(right.relative));
  for (let offset = 0; offset < candidates.length; offset += IO_CONCURRENCY) {
    const batch = candidates.slice(offset, offset + IO_CONCURRENCY);
    const loaded = await Promise.all(
      batch.map(async ({ uri, relative }) => {
        try {
          const bytes = await fs.readFile(uri);
          if (bytes.byteLength > MAX_FILE_BYTES) {
            throw new Error(`schema exceeds the ${MAX_FILE_BYTES / 1024} KiB size limit`);
          }
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
  const disposables: vscode.Disposable[] = [];
  const directory = schemaDirectory();
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(folder, `${directory}/**/*.recipe-schema.json`),
    );
    disposables.push(
      watcher,
      watcher.onDidCreate(callback),
      watcher.onDidChange(callback),
      watcher.onDidDelete(callback),
    );
  }
  return vscode.Disposable.from(...disposables);
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
