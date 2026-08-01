import path from 'node:path';
import * as vscode from 'vscode';
import type { ConnectorHello } from '@kubevs/protocol';

const SCRIPT_TEMPLATES: Readonly<Record<string, string>> = {
  server_scripts:
    '// Серверные рецепты и события KubeJS.\nServerEvents.recipes(event => {\n  // Код проекта\n})\n',
  client_scripts: '// Клиентские скрипты KubeJS.\n',
  startup_scripts: '// Startup-скрипты KubeJS. Изменения требуют перезапуска игры.\n',
};

export interface WorkspaceBootstrapResult {
  readonly prepared: boolean;
  readonly opened: boolean;
  readonly kubejsPath?: string;
}

export async function bootstrapConnectorWorkspace(
  hello: ConnectorHello,
  log: vscode.LogOutputChannel,
): Promise<WorkspaceBootstrapResult> {
  const kubejsPath = hello.workspace?.kubejsPath;
  const instancePath = hello.workspace?.instancePath;
  if (
    !kubejsPath ||
    !instancePath ||
    !path.isAbsolute(kubejsPath) ||
    !path.isAbsolute(instancePath) ||
    !samePath(path.dirname(kubejsPath), instancePath) ||
    path.basename(kubejsPath).toLocaleLowerCase('en') !== 'kubejs'
  ) {
    return { prepared: false, opened: false };
  }

  const instance = vscode.Uri.file(path.normalize(instancePath));
  if (!(await directoryExists(instance))) {
    log.warn(`Connector workspace is not available on this computer: ${instance.fsPath}.`);
    return { prepared: false, opened: false };
  }
  const target = vscode.Uri.file(path.normalize(kubejsPath));
  let prepared = false;
  if (vscode.workspace.getConfiguration('kubevs.connector').get('prepareWorkspace', true)) {
    await prepareKubeJsDirectory(target);
    prepared = true;
    log.info(`Prepared KubeJS workspace at ${target.fsPath}.`);
  }

  const current = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (current && samePath(current.fsPath, target.fsPath)) {
    await vscode.commands.executeCommand('kubevs.refreshProject');
    return { prepared, opened: false, kubejsPath: target.fsPath };
  }
  if (!vscode.workspace.getConfiguration('kubevs.connector').get('autoOpenWorkspace', true)) {
    return { prepared, opened: false, kubejsPath: target.fsPath };
  }
  if (!prepared && !(await directoryExists(target))) {
    log.warn(`KubeJS workspace does not exist and automatic preparation is disabled.`);
    return { prepared: false, opened: false, kubejsPath: target.fsPath };
  }

  void vscode.window.showInformationMessage(`KubeVS: открываю папку проекта ${target.fsPath}.`);
  log.info(`Opening Connector workspace ${target.fsPath}.`);
  await vscode.commands.executeCommand('vscode.openFolder', target, {
    forceReuseWindow: true,
  });
  return { prepared, opened: true, kubejsPath: target.fsPath };
}

async function prepareKubeJsDirectory(root: vscode.Uri): Promise<void> {
  await vscode.workspace.fs.createDirectory(root);
  await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(root, '.kubevs', 'cache'));
  await vscode.workspace.fs.createDirectory(
    vscode.Uri.joinPath(root, 'server_scripts', 'kubevs', 'crafts', 'vanilla'),
  );
  await vscode.workspace.fs.createDirectory(
    vscode.Uri.joinPath(root, 'server_scripts', 'kubevs', 'crafts', 'create'),
  );
  await vscode.workspace.fs.createDirectory(
    vscode.Uri.joinPath(root, 'server_scripts', 'kubevs', 'crafts', 'oritech'),
  );
  await vscode.workspace.fs.createDirectory(
    vscode.Uri.joinPath(root, 'server_scripts', 'kubevs', 'crafts', 'farmersdelight'),
  );
  await vscode.workspace.fs.createDirectory(
    vscode.Uri.joinPath(root, 'server_scripts', 'kubevs', 'crafts', 'generic'),
  );
  await vscode.workspace.fs.createDirectory(
    vscode.Uri.joinPath(root, 'server_scripts', 'kubevs', 'lootjs'),
  );
  for (const [directoryName, template] of Object.entries(SCRIPT_TEMPLATES)) {
    const directory = vscode.Uri.joinPath(root, directoryName);
    await vscode.workspace.fs.createDirectory(directory);
    await writeIfMissing(vscode.Uri.joinPath(directory, 'main.js'), template);
  }
}

async function writeIfMissing(target: vscode.Uri, contents: string): Promise<void> {
  try {
    await vscode.workspace.fs.stat(target);
  } catch (error) {
    if (!(error instanceof vscode.FileSystemError) || error.code !== 'FileNotFound') throw error;
    await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(contents));
  }
}

async function directoryExists(target: vscode.Uri): Promise<boolean> {
  try {
    const stat = await vscode.workspace.fs.stat(target);
    return (stat.type & vscode.FileType.Directory) !== 0;
  } catch {
    return false;
  }
}

function samePath(left: string, right: string): boolean {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  return process.platform === 'win32'
    ? normalizedLeft.toLocaleLowerCase('en') === normalizedRight.toLocaleLowerCase('en')
    : normalizedLeft === normalizedRight;
}
