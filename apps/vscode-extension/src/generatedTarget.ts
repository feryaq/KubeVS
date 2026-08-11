import * as vscode from 'vscode';
import path from 'node:path';
import {
  craftCategory,
  generatedArtifactStem,
  generatedDirectorySegments,
} from './generatedTargetCore.js';

export async function generatedDirectoryUri(): Promise<vscode.Uri> {
  const folder = await generatedWorkspaceFolder();
  if (!folder) throw new Error('Сначала откройте папку проекта.');

  const configured = vscode.workspace
    .getConfiguration('kubevs.generatedFiles')
    .get('directory', 'kubejs/server_scripts/kubevs');
  const segments = generatedDirectorySegments(
    path.basename(folder.uri.fsPath),
    configured,
    folder.uri.scheme,
  );
  const directory = vscode.Uri.joinPath(folder.uri, ...segments);
  await vscode.workspace.fs.createDirectory(directory);
  return directory;
}

export async function generatedStartupDirectoryUri(): Promise<vscode.Uri> {
  const folder = await generatedWorkspaceFolder();
  if (!folder) throw new Error('Сначала откройте папку проекта.');
  const configured = vscode.workspace
    .getConfiguration('kubevs.generatedFiles')
    .get('directory', 'kubejs/server_scripts/kubevs');
  const startupConfigured =
    /(^|[\\/])(server_scripts|client_scripts|startup_scripts)(?=[\\/]|$)/u.test(configured)
      ? configured.replace(
          /(^|[\\/])(server_scripts|client_scripts|startup_scripts)(?=[\\/]|$)/u,
          '$1startup_scripts',
        )
      : `kubejs/startup_scripts/${configured}`;
  const segments = generatedDirectorySegments(
    path.basename(folder.uri.fsPath),
    startupConfigured,
    folder.uri.scheme,
  );
  const directory = vscode.Uri.joinPath(folder.uri, ...segments);
  await vscode.workspace.fs.createDirectory(directory);
  return directory;
}

export async function generatedScriptTarget(
  recipeId: string,
  fallbackName: string,
): Promise<vscode.Uri> {
  const directory = await generatedDirectoryUri();
  const rawName = recipeId.split(':').at(-1) || fallbackName;
  const filename = `${rawName.replaceAll('/', '_').replace(/[^\p{L}\p{N}_.-]/gu, '_')}.js`;
  return vscode.Uri.joinPath(directory, filename);
}

export async function generatedCraftTarget(
  recipeId: string,
  recipeType: string,
  fallbackName: string,
): Promise<vscode.Uri> {
  const directory = await generatedDirectoryUri();
  const category = craftCategory(recipeType);
  const normalizedPath = directory.path.replace(/\/+$/u, '');
  const targetDirectory = normalizedPath.endsWith(`/crafts/${category}`)
    ? directory
    : normalizedPath.endsWith('/crafts')
      ? vscode.Uri.joinPath(directory, category)
      : vscode.Uri.joinPath(directory, 'crafts', category);
  await vscode.workspace.fs.createDirectory(targetDirectory);
  return vscode.Uri.joinPath(targetDirectory, generatedFilename(recipeId, fallbackName));
}

export async function generatedLootRuleTarget(target: string): Promise<vscode.Uri> {
  const directory = await generatedDirectoryUri();
  const normalizedPath = directory.path.replace(/\/+$/u, '');
  const targetDirectory = normalizedPath.endsWith('/lootjs')
    ? directory
    : normalizedPath.endsWith('/kubevs')
      ? vscode.Uri.joinPath(directory, 'lootjs')
      : vscode.Uri.joinPath(directory, 'kubevs', 'lootjs');
  await vscode.workspace.fs.createDirectory(targetDirectory);
  const name = target.replace(/^#/u, '');
  return vscode.Uri.joinPath(
    targetDirectory,
    `loot_${generatedArtifactStem(name, 'loot_rule')}.js`,
  );
}

function generatedFilename(recipeId: string, fallbackName: string): string {
  return `${generatedArtifactStem(recipeId, fallbackName)}.js`;
}
async function generatedWorkspaceFolder(): Promise<vscode.WorkspaceFolder | undefined> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const remote = folders.find((folder) => folder.uri.scheme === 'kubevs-remote');
  if (remote) {
    try {
      await vscode.workspace.fs.stat(remote.uri);
      return remote;
    } catch {
      // A disconnected remote folder must not block Offline Mode generation.
    }
  }

  const active = vscode.window.activeTextEditor
    ? vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri)
    : undefined;
  return active ?? folders.find((folder) => folder.uri.scheme === 'file') ?? folders[0];
}
