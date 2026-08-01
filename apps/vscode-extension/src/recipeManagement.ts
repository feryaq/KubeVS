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
          `Удалить рецепт ${recipeId} при следующей перезагрузке KubeJS?`,
          {
            modal: true,
            detail: 'Исходный JSON не изменяется. KubeVS создаст безопасное правило event.remove.',
          },
          'Удалить рецепт',
        );
        if (confirmed !== 'Удалить рецепт') return;
        const current = await readRemovedIds();
        await persistRemovedIds(context, withRemovedRecipe(current, recipeId));
        void vscode.window.showInformationMessage(
          `KubeVS: рецепт ${recipeId} добавлен в список удалённых.`,
        );
        await reloadManagedRecipeChanges(connector);
      } catch (error) {
        void vscode.window.showErrorMessage(
          `KubeVS не смог удалить рецепт: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }),
    vscode.commands.registerCommand('kubevs.restoreRecipe', async () => {
      try {
        const current = await readRemovedIds();
        if (current.length === 0) {
          void vscode.window.showInformationMessage('KubeVS: список удалённых рецептов пуст.');
          return;
        }
        const recipeId = await vscode.window.showQuickPick(current, {
          title: 'KubeVS — восстановить рецепт',
          placeHolder: 'Выберите правило удаления, которое нужно убрать',
          matchOnDescription: true,
        });
        if (!recipeId) return;
        await persistRemovedIds(context, withoutRemovedRecipe(current, recipeId));
        void vscode.window.showInformationMessage(`KubeVS: рецепт ${recipeId} восстановлен.`);
        await reloadManagedRecipeChanges(connector);
      } catch (error) {
        void vscode.window.showErrorMessage(
          `KubeVS не смог восстановить рецепт: ${error instanceof Error ? error.message : String(error)}`,
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
        title: 'KubeVS — удалить рецепт',
        placeHolder: `${snapshot.total.toLocaleString('ru-RU')} рецептов · поиск по ID или типу`,
        matchOnDescription: true,
      })
    )?.label;
  }
  return await vscode.window.showInputBox({
    title: 'KubeVS — удалить рецепт в Offline Mode',
    prompt: 'Введите полный ID рецепта',
    placeHolder: 'minecraft:diamond_pickaxe',
    validateInput: (value) =>
      /^[a-z0-9_.-]+:[a-z0-9_./-]+$/u.test(value) ? undefined : 'Ожидается namespace:recipe_id',
  });
}

async function persistRemovedIds(
  context: vscode.ExtensionContext,
  ids: readonly string[],
): Promise<void> {
  if (!vscode.workspace.workspaceFolders?.[0]) throw new Error('Сначала откройте папку проекта.');
  const scriptTarget = await generatedScriptTarget(
    'kubevs:zz_kubevs_removed_recipes',
    'zz_kubevs_removed_recipes',
  );
  const written = await writeFileWithDiff(context, scriptTarget, generateRecipeRemovalScript(ids), {
    diffTitle: 'KubeVS: список удалённых рецептов',
    confirmation: `Применить изменения к ${vscode.workspace.asRelativePath(scriptTarget)}?`,
    confirmButton: 'Применить',
    // This file is fully owned by KubeVS and rebuilt from the ID list above.
    // Do not interrupt delete/restore with a second save confirmation.
    confirmExisting: false,
  });
  if (!written) throw new Error('Изменение отменено пользователем.');
}

async function readRemovedIds(): Promise<string[]> {
  if (!vscode.workspace.workspaceFolders?.[0]) throw new Error('Сначала откройте папку проекта.');
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
