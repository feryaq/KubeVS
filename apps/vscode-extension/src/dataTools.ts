import * as path from 'node:path';
import * as vscode from 'vscode';
import type { ModSnapshot, PagedIds } from '@kubevs/protocol';
import { generateKubeJs, importRecipeJson } from '@kubevs/recipe-model';
import type { ConnectorClient } from './connectorClient.js';
import { writeFileWithDiff } from './safeWrite.js';

interface RegistryList {
  readonly entries: readonly string[];
  readonly total: number;
}

interface RecipeTypes {
  readonly types: Readonly<Record<string, readonly string[]>>;
  readonly total: number;
}

interface RecipeJson {
  readonly id: string;
  readonly recipeType: string;
  readonly json: unknown;
}

export function registerDataTools(
  context: vscode.ExtensionContext,
  connector: ConnectorClient,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('kubevs.insertRegistryArray', async () => {
      await runConnectorCommand(async () => {
        const registry = await pickRegistry(connector);
        if (!registry) return;
        const entries = await fetchAll(connector, 'registry.entries', { registry });
        const filtered = await filterIds(entries);
        if (!filtered) return;
        await insertJson(filtered);
      });
    }),
    vscode.commands.registerCommand('kubevs.insertTaggedValues', async () => {
      await runConnectorCommand(async () => {
        const registry = await pickRegistry(connector);
        if (!registry) return;
        const tags = await fetchAll(connector, 'registry.tags', { registry });
        const selected = await vscode.window.showQuickPick(tags, {
          canPickMany: true,
          placeHolder: 'Select tags whose registry values should be inserted',
        });
        if (!selected || selected.length === 0) return;
        const values = new Set<string>();
        for (const tag of selected) {
          const tagged = await fetchAll(connector, 'registry.tagValues', { registry, tag });
          tagged.forEach((value) => values.add(value));
        }
        await insertJson([...values].sort());
      });
    }),
    vscode.commands.registerCommand('kubevs.insertRecipeJson', async () => {
      await runConnectorCommand(async () => {
        const recipe = await pickRecipe(connector);
        if (!recipe) return;
        await insertJson(recipe.json);
      });
    }),
    vscode.commands.registerCommand('kubevs.insertRecipeAsKubeJs', async () => {
      await runConnectorCommand(async () => {
        const snapshot = await pickRecipe(connector);
        if (!snapshot) return;
        const imported = importRecipeJson(snapshot.id, snapshot.json);
        const errors = imported.issues.filter((issue) => issue.severity === 'error');
        if (errors.length > 0) {
          throw new Error(errors.map((issue) => `${issue.path}: ${issue.message}`).join('\n'));
        }
        await insertText(generateKubeJs(imported.recipe));
        const warnings = imported.issues.filter((issue) => issue.severity === 'warning');
        if (warnings.length > 0) {
          void vscode.window.showWarningMessage(`KubeVS: ${warnings[0]?.message}`);
        }
      });
    }),
    vscode.commands.registerCommand('kubevs.generateTypings', async () => {
      await runConnectorCommand(async () => {
        if (!vscode.workspace.isTrusted) {
          throw new Error('Typing generation requires a trusted workspace.');
        }
        const root = await findKubeJsRoot();
        if (!root) throw new Error('No KubeJS script root was found.');
        const [items, blocks, fluids, itemTags, mods] = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'KubeVS: generating live TypeScript declarations',
            cancellable: true,
          },
          async (_progress, token) => {
            return await Promise.all([
              fetchAll(connector, 'registry.entries', { registry: 'minecraft:item' }, token),
              fetchAll(connector, 'registry.entries', { registry: 'minecraft:block' }, token),
              fetchAll(connector, 'registry.entries', { registry: 'minecraft:fluid' }, token),
              fetchAll(connector, 'registry.tags', { registry: 'minecraft:item' }, token),
              connector.request<ModSnapshot>('mods.list'),
            ]);
          },
        );
        const content = declarations({
          items,
          blocks,
          fluids,
          itemTags,
          mods: mods.entries.map((mod) => mod.id),
        });
        const targetDirectory = vscode.Uri.joinPath(root, '.kubevs', 'generated');
        const target = vscode.Uri.joinPath(targetDirectory, 'registries.d.ts');
        await vscode.workspace.fs.createDirectory(targetDirectory);
        const written = await writeFileWithDiff(context, target, content, {
          diffTitle: 'KubeVS generated typings: current ↔ proposed',
          confirmation: `Replace ${vscode.workspace.asRelativePath(target)} with generated typings?`,
          confirmExisting: vscode.workspace
            .getConfiguration('kubevs.generatedFiles')
            .get('confirmOverwrite', true),
        });
        if (written) {
          void vscode.window.showInformationMessage(
            `KubeVS generated ${items.length.toLocaleString()} item typings.`,
          );
        }
      });
    }),
  );
}

async function pickRegistry(connector: ConnectorClient): Promise<string | undefined> {
  const snapshot = await connector.request<RegistryList>('registry.list');
  return await vscode.window.showQuickPick(snapshot.entries, {
    placeHolder: `${snapshot.total.toLocaleString()} registries · select one`,
    matchOnDescription: true,
  });
}

async function pickRecipe(connector: ConnectorClient): Promise<RecipeJson | undefined> {
  const snapshot = await connector.request<RecipeTypes>('recipes.types');
  const type = await vscode.window.showQuickPick(Object.keys(snapshot.types).sort(), {
    placeHolder: `${snapshot.total.toLocaleString()} recipes · select a type`,
  });
  if (!type) return undefined;
  const id = await vscode.window.showQuickPick(snapshot.types[type] ?? [], {
    placeHolder: 'Select a recipe',
    matchOnDescription: true,
  });
  return id ? await connector.request<RecipeJson>('recipes.get', { id }) : undefined;
}

async function fetchAll(
  connector: ConnectorClient,
  method: string,
  params: Readonly<Record<string, unknown>>,
  cancellation?: vscode.CancellationToken,
): Promise<string[]> {
  const values: string[] = [];
  let offset = 0;
  do {
    if (cancellation?.isCancellationRequested) {
      throw new vscode.CancellationError();
    }
    const page = await connector.request<PagedIds>(method, { ...params, offset, limit: 500 });
    values.push(...page.entries);
    if (!page.hasMore) break;
    offset = page.offset + page.entries.length;
  } while (values.length < 100_000);
  return values;
}

async function filterIds(entries: readonly string[]): Promise<string[] | undefined> {
  const input = await vscode.window.showInputBox({
    title: 'Filter registry entries',
    prompt: 'Semicolon-separated regex filters. Prefix a filter with ! to exclude matches.',
    placeHolder: 'create:.*;!.*_incomplete',
    value: '.*',
  });
  if (input === undefined) return undefined;
  let filters: readonly { readonly exclude: boolean; readonly expression: RegExp }[];
  try {
    filters = input
      .split(';')
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => ({
        exclude: value.startsWith('!'),
        expression: new RegExp(value.startsWith('!') ? value.slice(1) : value, 'u'),
      }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(`Invalid regular expression: ${message}`);
    return undefined;
  }
  return entries.filter((entry) =>
    filters.every((filter) =>
      filter.exclude ? !filter.expression.test(entry) : filter.expression.test(entry),
    ),
  );
}

async function insertJson(value: unknown): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) throw new Error('Open a text editor before inserting data.');
  await editor.insertSnippet(new vscode.SnippetString(JSON.stringify(value, null, 2)));
}

async function insertText(value: string): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) throw new Error('Open a text editor before inserting data.');
  const inserted = await editor.edit((builder) => {
    builder.replace(editor.selection, value);
  });
  if (!inserted) throw new Error('VS Code rejected the recipe edit.');
}

async function findKubeJsRoot(): Promise<vscode.Uri | undefined> {
  const files = await vscode.workspace.findFiles(
    '**/{server_scripts,client_scripts,startup_scripts}/**/*.{js,ts}',
    '**/{node_modules,.git,build}/**',
    1,
  );
  const first = files[0];
  if (!first) return undefined;
  const segments = first.fsPath.split(path.sep);
  const index = segments.findIndex((segment) =>
    ['server_scripts', 'client_scripts', 'startup_scripts'].includes(segment),
  );
  if (index < 1) return undefined;
  return vscode.Uri.file(segments.slice(0, index).join(path.sep));
}

function declarations(data: {
  readonly items: readonly string[];
  readonly blocks: readonly string[];
  readonly fluids: readonly string[];
  readonly itemTags: readonly string[];
  readonly mods: readonly string[];
}): string {
  return [
    '// @generated by KubeVS. Manual edits will be replaced after confirmation.',
    '// Live declarations from the connected Minecraft instance.',
    '',
    union('KubeVSItemId', data.items),
    union('KubeVSBlockId', data.blocks),
    union('KubeVSFluidId', data.fluids),
    union('KubeVSItemTag', data.itemTags),
    union('KubeVSModId', data.mods),
    '',
  ].join('\n');
}

function union(name: string, values: readonly string[]): string {
  if (values.length === 0) return `type ${name} = never;\n`;
  return `type ${name} =\n${[...values]
    .sort()
    .map((value) => `  | ${JSON.stringify(value)}`)
    .join('\n')};\n`;
}

async function runConnectorCommand(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    if (error instanceof vscode.CancellationError) return;
    const message = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(`KubeVS: ${message}`);
  }
}
