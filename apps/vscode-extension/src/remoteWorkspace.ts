import * as vscode from 'vscode';
import type { ConnectorClient } from './connectorClient.js';

const SCHEME = 'kubevs-remote';

interface RemoteFileEntry {
  readonly path: string;
  readonly size: number;
  readonly revision: string;
}

interface RemoteFileList {
  readonly entries: readonly RemoteFileEntry[];
  readonly total: number;
}

interface RemoteFileContent {
  readonly path: string;
  readonly content: string;
  readonly revision: string;
}

interface RemoteLock {
  readonly path: string;
  readonly acquired?: boolean;
  readonly locked?: boolean;
  readonly owner?: string;
  readonly ownerSessionId?: string;
}

interface RemoteLockList {
  readonly entries: readonly RemoteLock[];
  readonly total: number;
}

export function registerRemoteWorkspace(
  context: vscode.ExtensionContext,
  connector: ConnectorClient,
): void {
  const provider = new RemoteFileSystemProvider(connector);
  const opened = new Set<string>();
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider(SCHEME, provider, {
      isCaseSensitive: true,
      isReadonly: false,
    }),
    vscode.commands.registerCommand('kubevs.openServerWorkspace', async () => {
      try {
        if (!connector.capabilities?.workspaceFiles) {
          throw new Error('У этой сессии нет права читать серверные файлы.');
        }
        const snapshot = await provider.refresh();
        const selected = await vscode.window.showQuickPick(
          snapshot.entries.map((entry) => ({
            label: entry.path.split('/').at(-1) ?? entry.path,
            description: entry.path,
            detail: `${entry.size.toLocaleString('ru-RU')} байт`,
            entry,
          })),
          {
            title: 'KubeVS — серверные скрипты',
            placeHolder: 'Выберите файл. KubeVS заблокирует его на время редактирования.',
            matchOnDescription: true,
            matchOnDetail: true,
          },
        );
        if (!selected) return;
        if (connector.capabilities.workspaceLocks) {
          const lock = await connector.request<RemoteLock>('workspace.locks.acquire', {
            path: selected.entry.path,
          });
          if (!lock.acquired) {
            void vscode.window.showWarningMessage(
              `KubeVS: файл занят пользователем ${lock.owner ?? 'другой участник'}.`,
            );
            return;
          }
        }
        const uri = remoteUri(selected.entry.path);
        if (connector.capabilities.workspaceLocks) opened.add(uri.toString());
        const document = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(document, { preview: false });
        void vscode.window.setStatusBarMessage(
          connector.capabilities.workspaceLocks
            ? `$(lock) KubeVS: ${selected.entry.path} заблокирован за вами`
            : `$(eye) KubeVS: ${selected.entry.path} открыт только для чтения`,
          5000,
        );
      } catch (error) {
        void vscode.window.showErrorMessage(
          `KubeVS: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }),
    vscode.commands.registerCommand('kubevs.showServerFileLocks', async () => {
      try {
        const locks = await connector.request<RemoteLockList>('workspace.locks.list');
        if (locks.entries.length === 0) {
          void vscode.window.showInformationMessage('KubeVS: занятых серверных файлов нет.');
          return;
        }
        await vscode.window.showQuickPick(
          locks.entries.map((lock) => ({
            label: lock.path,
            description: lock.owner ?? 'неизвестный пользователь',
          })),
          { title: 'KubeVS — занятые серверные файлы' },
        );
      } catch (error) {
        void vscode.window.showErrorMessage(
          `KubeVS: не удалось получить блокировки: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }),
    vscode.workspace.onDidCloseTextDocument((document) => {
      const key = document.uri.toString();
      if (document.uri.scheme !== SCHEME || !opened.delete(key)) return;
      void connector
        .request<RemoteLock>('workspace.locks.release', {
          path: relativePath(document.uri),
        })
        .catch(() => undefined);
    }),
  );
}

class RemoteFileSystemProvider implements vscode.FileSystemProvider {
  private readonly changed = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this.changed.event;
  private entries = new Map<string, RemoteFileEntry>();
  private revisions = new Map<string, string>();

  constructor(private readonly connector: ConnectorClient) {}

  watch(): vscode.Disposable {
    return new vscode.Disposable(() => undefined);
  }

  async refresh(): Promise<RemoteFileList> {
    const snapshot = await this.connector.request<RemoteFileList>('workspace.files.list');
    this.entries = new Map(snapshot.entries.map((entry) => [entry.path, entry]));
    return snapshot;
  }

  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    const path = relativePath(uri);
    if (!path) {
      return { type: vscode.FileType.Directory, ctime: 0, mtime: 0, size: 0 };
    }
    if (this.entries.size === 0) await this.refresh();
    const file = this.entries.get(path);
    if (file) {
      return { type: vscode.FileType.File, ctime: 0, mtime: 0, size: file.size };
    }
    if ([...this.entries].some(([entry]) => entry.startsWith(`${path}/`))) {
      return { type: vscode.FileType.Directory, ctime: 0, mtime: 0, size: 0 };
    }
    throw vscode.FileSystemError.FileNotFound(uri);
  }

  async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    if (this.entries.size === 0) await this.refresh();
    const root = relativePath(uri);
    const prefix = root ? `${root}/` : '';
    const children = new Map<string, vscode.FileType>();
    for (const path of this.entries.keys()) {
      if (!path.startsWith(prefix)) continue;
      const remaining = path.slice(prefix.length);
      const [name, ...rest] = remaining.split('/');
      if (!name) continue;
      children.set(name, rest.length === 0 ? vscode.FileType.File : vscode.FileType.Directory);
    }
    return [...children];
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    try {
      const file = await this.connector.request<RemoteFileContent>('workspace.files.read', {
        path: relativePath(uri),
      });
      this.revisions.set(file.path, file.revision);
      return new TextEncoder().encode(file.content);
    } catch (error) {
      throw vscode.FileSystemError.Unavailable(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async writeFile(
    uri: vscode.Uri,
    content: Uint8Array,
    _options: { readonly create: boolean; readonly overwrite: boolean },
  ): Promise<void> {
    void _options;
    const path = relativePath(uri);
    try {
      const written = await this.connector.request<RemoteFileContent>('workspace.files.write', {
        path,
        content: new TextDecoder().decode(content),
        expectedRevision: this.revisions.get(path) ?? '',
      });
      this.revisions.set(path, written.revision);
      this.entries.set(path, {
        path,
        size: content.byteLength,
        revision: written.revision,
      });
      this.changed.fire([{ type: vscode.FileChangeType.Changed, uri }]);
    } catch (error) {
      throw vscode.FileSystemError.Unavailable(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  createDirectory(): void {
    throw vscode.FileSystemError.NoPermissions('Создание серверных папок пока отключено.');
  }

  delete(): void {
    throw vscode.FileSystemError.NoPermissions('Удаление серверных файлов пока отключено.');
  }

  rename(): void {
    throw vscode.FileSystemError.NoPermissions('Переименование серверных файлов пока отключено.');
  }
}

function remoteUri(path: string): vscode.Uri {
  return vscode.Uri.from({ scheme: SCHEME, authority: 'server', path: `/${path}` });
}

function relativePath(uri: vscode.Uri): string {
  return decodeURIComponent(uri.path).replace(/^\/+/u, '');
}
