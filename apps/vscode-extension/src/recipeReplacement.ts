import * as vscode from 'vscode';
import type { ConnectorClient } from './connectorClient.js';
import { generatedCraftTarget } from './generatedTarget.js';
import { buildRecipeReplacement } from './recipeReplacementCore.js';
import { writeFileWithDiff } from './safeWrite.js';

interface RecipeTypes {
  readonly types: Readonly<Record<string, readonly string[]>>;
  readonly total: number;
}

interface RecipeSnapshot {
  readonly id: string;
  readonly recipeType: string;
  readonly json: unknown;
}

interface RecipePick extends vscode.QuickPickItem {
  readonly recipeId: string;
  readonly recipeType: string;
}

export function registerRecipeReplacement(
  context: vscode.ExtensionContext,
  connector: ConnectorClient,
): vscode.Disposable {
  const disposable = vscode.commands.registerCommand('kubevs.replaceRecipe', async () => {
    try {
      await replaceRecipe(context, connector);
    } catch (error) {
      if (error instanceof vscode.CancellationError) return;
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`KubeVS: ${message}`);
    }
  });
  context.subscriptions.push(disposable);
  return disposable;
}

export async function replaceRecipe(
  context: vscode.ExtensionContext,
  connector: ConnectorClient,
): Promise<void> {
  const snapshot = await connector.request<RecipeTypes>('recipes.types');
  const choices = recipePicks(snapshot);
  if (choices.length === 0) throw new Error('Connector не вернул ни одного рецепта.');

  const target = await vscode.window.showQuickPick(choices, {
    title: 'Какой рецепт заменить?',
    placeHolder: 'Поиск по ID или типу рецепта',
    matchOnDescription: true,
    matchOnDetail: true,
  });
  if (!target) return;

  const source = await vscode.window.showQuickPick(choices, {
    title: `Чем заменить ${target.recipeId}?`,
    placeHolder: 'Выберите готовый рецепт-шаблон',
    matchOnDescription: true,
    matchOnDetail: true,
  });
  if (!source) return;

  const confirmed = await vscode.window.showWarningMessage(
    `Заменить ${target.recipeId} определением из ${source.recipeId}?`,
    {
      modal: true,
      detail: 'Будет создан managed-файл KubeVS. Исходные файлы модов не изменяются.',
    },
    'Заменить по ID',
  );
  if (confirmed !== 'Заменить по ID') return;

  const sourceSnapshot = await connector.request<RecipeSnapshot>('recipes.get', {
    id: source.recipeId,
  });
  const replacement = buildRecipeReplacement(
    target.recipeId,
    sourceSnapshot.id,
    sourceSnapshot.json,
  );
  const file = await generatedCraftTarget(
    replacement.targetId,
    replacement.recipeType,
    'replacement',
  );
  const written = await writeFileWithDiff(context, file, replacement.code, {
    diffTitle: 'KubeVS: замена рецепта',
    confirmation: `Заменить managed-файл ${vscode.workspace.asRelativePath(file)}?`,
    confirmExisting: false,
  });
  if (!written) return;

  const document = await vscode.workspace.openTextDocument(file);
  await vscode.window.showTextDocument(document, { preview: false });
  if (replacement.warnings.length > 0) {
    void vscode.window.showWarningMessage(`KubeVS: ${replacement.warnings[0]}`);
  } else {
    void vscode.window.showInformationMessage(
      `KubeVS: ${target.recipeId} заменён рецептом ${source.recipeId}.`,
    );
  }
}

export function recipePicks(snapshot: RecipeTypes): RecipePick[] {
  return Object.entries(snapshot.types)
    .flatMap(([recipeType, ids]) =>
      ids.map((recipeId) => ({
        label: recipeId,
        description: recipeType,
        detail: humanizeRecipeId(recipeId),
        recipeId,
        recipeType,
      })),
    )
    .sort((left, right) => left.recipeId.localeCompare(right.recipeId));
}

function humanizeRecipeId(recipeId: string): string {
  const path = recipeId.split(':', 2)[1] ?? recipeId;
  return (path.split('/').at(-1) ?? path)
    .replaceAll('_', ' ')
    .replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase('ru'));
}
