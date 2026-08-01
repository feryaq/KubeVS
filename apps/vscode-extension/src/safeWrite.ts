import * as path from 'node:path';
import * as vscode from 'vscode';

export interface SafeWriteOptions {
  readonly diffTitle: string;
  readonly confirmation: string;
  readonly confirmButton?: string;
  readonly confirmExisting?: boolean;
}

export async function writeFileWithDiff(
  context: vscode.ExtensionContext,
  target: vscode.Uri,
  content: string,
  options: SafeWriteOptions,
): Promise<boolean> {
  let current: Uint8Array | undefined;
  try {
    current = await vscode.workspace.fs.readFile(target);
  } catch (error) {
    if (!isFileNotFound(error)) throw error;
  }

  const next = new TextEncoder().encode(content);
  if (current && bytesEqual(current, next)) return true;

  if (current && options.confirmExisting !== false) {
    await vscode.workspace.fs.createDirectory(context.globalStorageUri);
    const extension = path.extname(target.path);
    const proposed = vscode.Uri.joinPath(
      context.globalStorageUri,
      `proposed-${Date.now()}-${createNonce()}${extension}`,
    );
    await vscode.workspace.fs.writeFile(proposed, next);
    let choice: string | undefined;
    const confirmButton = options.confirmButton ?? 'Replace';
    try {
      await vscode.commands.executeCommand('vscode.diff', target, proposed, options.diffTitle, {
        preview: true,
      });
      choice = await vscode.window.showWarningMessage(
        options.confirmation,
        { modal: true },
        confirmButton,
      );
    } finally {
      try {
        await vscode.workspace.fs.delete(proposed);
      } catch {
        // Global-storage cleanup is best effort.
      }
    }
    if (choice !== confirmButton) return false;
  }

  if (current) {
    const latest = await vscode.workspace.fs.readFile(target);
    if (!bytesEqual(current, latest)) {
      throw new Error(
        'The target changed while its diff was open. Review the new version and save again.',
      );
    }
  } else {
    try {
      await vscode.workspace.fs.readFile(target);
      throw new Error('The target was created by another process. Save again to review its diff.');
    } catch (error) {
      if (!isFileNotFound(error)) throw error;
    }
  }

  await vscode.workspace.fs.writeFile(target, next);
  return true;
}

function isFileNotFound(error: unknown): boolean {
  return error instanceof vscode.FileSystemError && error.code === 'FileNotFound';
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function createNonce(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from(
    { length: 32 },
    () => alphabet[Math.floor(Math.random() * alphabet.length)],
  ).join('');
}
