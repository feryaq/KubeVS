import * as vscode from 'vscode';
import { importRecipeJson, generateKubeJs } from '@kubevs/recipe-model';
import { generatedCraftTarget } from './generatedTarget.js';
import { writeFileWithDiff } from './safeWrite.js';

export async function importRecipeFile(context: vscode.ExtensionContext): Promise<void> {
  const selected = await vscode.window.showOpenDialog({
    canSelectMany: false,
    canSelectFiles: true,
    canSelectFolders: false,
    filters: { 'Recipe JSON': ['json'] },
    openLabel: 'Import recipe',
  });
  const source = selected?.[0];
  if (!source) return;
  const stat = await vscode.workspace.fs.stat(source);
  if (stat.size > 1_048_576) throw new Error('Recipe JSON must be smaller than 1 MiB.');
  const json: unknown = JSON.parse(
    new TextDecoder().decode(await vscode.workspace.fs.readFile(source)),
  );
  const stem = (source.path.split('/').at(-1) ?? 'recipe')
    .replace(/\.json$/iu, '')
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/gu, '_');
  const id = await vscode.window.showInputBox({
    title: 'Import recipe',
    prompt: 'ID for the generated recipe',
    value: `kubevs:${stem}`,
    validateInput: (value) =>
      /^[a-z0-9_.-]+:[a-z0-9_./-]+$/u.test(value) ? undefined : 'Use namespace:recipe_id.',
  });
  if (!id) return;
  const imported = importRecipeJson(id, json);
  const errors = imported.issues.filter((issue) => issue.severity === 'error');
  if (errors.length) throw new Error(errors.map((issue) => issue.message).join(' '));
  const target = await generatedCraftTarget(id, 'minecraft:crafting', 'recipe');
  const code = `// Imported by KubeVS\nServerEvents.recipes(event => {\n  ${generateKubeJs(imported.recipe).replaceAll('\n', '\n  ')}\n});\n`;
  if (
    await writeFileWithDiff(context, target, code, {
      diffTitle: 'KubeVS import: current ↔ proposed',
      confirmation: `Replace ${vscode.workspace.asRelativePath(target)}? Review the open diff first.`,
    })
  ) {
    const document = await vscode.workspace.openTextDocument(target);
    await vscode.window.showTextDocument(document, { preview: false });
  }
}
