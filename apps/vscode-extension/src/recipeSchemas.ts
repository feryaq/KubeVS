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

export async function loadRecipeSchemas(): Promise<RecipeSchemaCatalog> {
  const directory = schemaDirectory();
  const entries: RecipeSchemaCatalogEntry[] = [
    { schema: RAW_SCHEMA, source: 'Built in', builtIn: true },
  ];
  const errors: string[] = [];
  const seen = new Set(entries.map((entry) => entry.schema.id));

  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const pattern = new vscode.RelativePattern(folder, `${directory}/**/*.recipe-schema.json`);
    const files = await vscode.workspace.findFiles(pattern, undefined, 200);
    for (const file of files.sort((left, right) => left.path.localeCompare(right.path))) {
      const relative = vscode.workspace.asRelativePath(file);
      try {
        const bytes = await vscode.workspace.fs.readFile(file);
        if (bytes.byteLength > 256 * 1024) {
          throw new Error('schema exceeds the 256 KiB size limit');
        }
        const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
        const schema = parseRecipeSchema(parsed);
        if (seen.has(schema.id)) throw new Error(`duplicate schema id ${schema.id}`);
        seen.add(schema.id);
        entries.push({ schema, source: relative, builtIn: false });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${relative}: ${message}`);
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
