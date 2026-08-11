import * as vscode from 'vscode';
import type { ConnectorClient } from './connectorClient.js';
import { generatedScriptTarget } from './generatedTarget.js';
import {
  generateRecipeRemovalScript,
  parseRemovedRecipeIds,
  withRemovedRecipe,
  withoutRemovedRecipe,
} from './recipeRemovalCore.js';
import { writeFileWithDiff } from './safeWrite.js';

interface RecipeTypes {
  readonly types: Readonly<Record<string, readonly string[]>>;
  readonly total: number;
}

export function registerRecipeManagement(
  context: vscode.ExtensionContext,
  connector: ConnectorClient,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('kubevs.deleteRecipe', async () => {
      try {
        const recipeId = await selectRecipeToDelete(connector);
        if (!recipeId) return;
        const confirmed = await vscode.window.showWarningMessage(
          `Remove recipe ${recipeId} on the next KubeJS reload?`,
          {
            modal: true,
            detail: 'The original JSON is unchanged. KubeVS creates a safe event.remove rule.',
          },
          'Remove Recipe',
        );
        if (confirmed !== 'Remove Recipe') return;
        const current = await readRemovedIds();
        await persistRemovedIds(context, withRemovedRecipe(current, recipeId));
        void vscode.window.showInformationMessage(
          `KubeVS: recipe ${recipeId} added to the removed recipe list.`,
        );
        await reloadManagedRecipeChanges(connector);
      } catch (error) {
        void vscode.window.showErrorMessage(
          `KubeVS could not remove the recipe: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }),
    vscode.commands.registerCommand('kubevs.restoreRecipe', async () => {
      try {
        const current = await readRemovedIds();
        if (current.length === 0) {
          void vscode.window.showInformationMessage('KubeVS: the removed recipe list is empty.');
          return;
        }
        const recipeId = await vscode.window.showQuickPick(current, {
          title: 'KubeVS — Restore Recipe',
          placeHolder: 'Select the removal rule to delete',
          matchOnDescription: true,
        });
        if (!recipeId) return;
        await persistRemovedIds(context, withoutRemovedRecipe(current, recipeId));
        void vscode.window.showInformationMessage(`KubeVS: recipe ${recipeId} restored.`);
        await reloadManagedRecipeChanges(connector);
      } catch (error) {
        void vscode.window.showErrorMessage(
          `KubeVS could not restore the recipe: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }),
  );
}

async function reloadManagedRecipeChanges(connector: ConnectorClient): Promise<void> {
  if (!connector.capabilities?.reload) return;
  await connector.request<{ readonly reloaded: boolean }>('reload.server');
}

async function selectRecipeToDelete(connector: ConnectorClient): Promise<string | undefined> {
  if (connector.capabilities) {
    const snapshot = await connector.request<RecipeTypes>('recipes.types');
    const items = Object.entries(snapshot.types)
      .flatMap(([type, ids]) => ids.map((id) => ({ label: id, description: type })))
      .sort((left, right) => left.label.localeCompare(right.label, 'en'));
    return (
      await vscode.window.showQuickPick(items, {
        title: 'KubeVS — Remove Recipe',
        placeHolder: `${snapshot.total.toLocaleString('en-US')} recipes · search by ID or type`,
        matchOnDescription: true,
      })
    )?.label;
  }
  return await vscode.window.showInputBox({
    title: 'KubeVS — Remove Recipe in Offline Mode',
    prompt: 'Enter the full recipe ID',
    placeHolder: 'minecraft:diamond_pickaxe',
    validateInput: (value) =>
      /^[a-z0-9_.-]+:[a-z0-9_./-]+$/u.test(value) ? undefined : 'Expected namespace:recipe_id',
  });
}

async function persistRemovedIds(
  context: vscode.ExtensionContext,
  ids: readonly string[],
): Promise<void> {
  if (!vscode.workspace.workspaceFolders?.[0]) throw new Error('Open a project folder first.');
  const scriptTarget = await generatedScriptTarget(
    'kubevs:zz_kubevs_removed_recipes',
    'zz_kubevs_removed_recipes',
  );
  const written = await writeFileWithDiff(context, scriptTarget, generateRecipeRemovalScript(ids), {
    diffTitle: 'KubeVS: Removed Recipe List',
    confirmation: `Apply changes to ${vscode.workspace.asRelativePath(scriptTarget)}?`,
    confirmButton: 'Apply',
    // This file is fully owned by KubeVS and rebuilt from the ID list above.
    // Do not interrupt delete/restore with a second save confirmation.
    confirmExisting: false,
  });
  if (!written) throw new Error('The change was cancelled by the user.');
}

async function readRemovedIds(): Promise<string[]> {
  if (!vscode.workspace.workspaceFolders?.[0]) throw new Error('Open a project folder first.');
  const target = await generatedScriptTarget(
    'kubevs:zz_kubevs_removed_recipes',
    'zz_kubevs_removed_recipes',
  );
  try {
    const bytes = await vscode.workspace.fs.readFile(target);
    const source = new TextDecoder().decode(bytes);
    return parseRemovedRecipeIds(
      [
        ...source.matchAll(
          /event\.remove\(\{\s*id:\s*(["'])([a-z0-9_.-]+:[a-z0-9_./-]+)\1\s*\}\)/gu,
        ),
      ].map((match) => match[2]),
    );
  } catch (error) {
    if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') return [];
    throw error;
  }
}
