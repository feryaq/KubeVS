import * as vscode from 'vscode';
import { ConnectorRequestError, type ConnectorClient } from './connectorClient.js';
import { t } from './localization.js';

const SCHEME = 'kubevs-remote';
const AUTHORITY = 'server';
const POLL_INTERVAL_MS = 2_500;

interface RemoteFileEntry {
  readonly path: string;
  readonly type: 'file' | 'directory';
  readonly size: number;
  readonly mtime: number;
  readonly revision: string;
}

interface RemoteFileList {
  readonly entries: readonly RemoteFileEntry[];
  readonly total: number;
}

interface RemoteFileContent extends RemoteFileEntry {
  readonly encoding: 'base64';
  readonly data: string;
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

interface RemoteMutationResult {
  readonly entries?: readonly RemoteFileEntry[];
  readonly entry?: RemoteFileEntry;
}

export function registerRemoteWorkspace(
  context: vscode.ExtensionContext,
  connector: ConnectorClient,
): void {
  const provider = new RemoteFileSystemProvider(connector);
  context.subscriptions.push(
    provider,
    vscode.workspace.registerFileSystemProvider(SCHEME, provider, {
      isCaseSensitive: true,
      isReadonly: false,
    }),
    vscode.commands.registerCommand('kubevs.openServerWorkspace', async () => {
      try {
        if (!connector.capabilities?.workspaceFiles) {
          throw new Error(t('Your role does not allow reading server KubeJS files.'));
        }

        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: t('KubeVS: connecting server KubeJS workspace'),
          },
          () => provider.refresh(),
        );

        const uri = remoteUri('');
        const existing = vscode.workspace.workspaceFolders?.some(
          (folder) => folder.uri.scheme === SCHEME && folder.uri.authority === AUTHORITY,
        );
        if (!existing) {
          const added = vscode.workspace.updateWorkspaceFolders(
            vscode.workspace.workspaceFolders?.length ?? 0,
            0,
            {
              uri,
              name: t('KubeJS — {0}', connector.session?.displayName ?? t('server')),
            },
          );
          if (!added) {
            throw new Error(t('VS Code could not add the server folder to the workspace.'));
          }
        }

        await vscode.commands.executeCommand('workbench.view.explorer');
        const role = connector.session?.role ?? 'viewer';
        const mode = connector.capabilities.workspaceWrite ? t('read and write') : t('read only');
        void vscode.window.showInformationMessage(
          t('KubeVS: server KubeJS workspace connected ({0}, {1}).', role, mode),
        );
      } catch (error) {
        void vscode.window.showErrorMessage(
          t('KubeVS: could not connect the server workspace. {0}', messageOf(error)),
        );
      }
    }),
    vscode.commands.registerCommand('kubevs.showServerFileLocks', async () => {
      try {
        const locks = await connector.request<RemoteLockList>('workspace.locks.list');
        if (locks.entries.length === 0) {
          void vscode.window.showInformationMessage(t('KubeVS: no server files are locked.'));
          return;
        }
        await vscode.window.showQuickPick(
          locks.entries.map((lock) => ({
            label: lock.path,
            description: lock.owner ?? t('unknown user'),
            iconPath: new vscode.ThemeIcon('lock'),
          })),
          { title: t('KubeVS — files opened by team members') },
        );
      } catch (error) {
        void vscode.window.showErrorMessage(
          t('KubeVS: could not load file locks. {0}', messageOf(error)),
        );
      }
    }),
    vscode.workspace.onDidOpenTextDocument((document) => {
      if (document.uri.scheme === SCHEME) void provider.openDocument(document.uri);
    }),
    vscode.workspace.onDidCloseTextDocument((document) => {
      if (document.uri.scheme === SCHEME) void provider.closeDocument(document.uri);
    }),
  );
}

class RemoteFileSystemProvider implements vscode.FileSystemProvider, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this.changed.event;

  private entries = new Map<string, RemoteFileEntry>();
  private revisions = new Map<string, string>();
  private readonly openDocuments = new Set<string>();
  private readonly heldLocks = new Set<string>();
  private readonly deniedLocks = new Map<string, string>();
  private watchers = 0;
  private pollTimer: NodeJS.Timeout | undefined;
  private refreshInFlight: Promise<RemoteFileList> | undefined;
  private readonly stopEvents: () => void;

  constructor(private readonly connector: ConnectorClient) {
    this.stopEvents = connector.onEvent((event) => {
      if (event.event === 'workspace.changed') {
        void this.refresh(true).catch(() => undefined);
      }
    });
  }

  dispose(): void {
    this.stopEvents();
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.changed.dispose();
  }

  watch(
    _uri: vscode.Uri,
    _options: { readonly recursive: boolean; readonly excludes: readonly string[] },
  ): vscode.Disposable {
    void _uri;
    void _options;
    this.watchers++;
    this.ensurePolling();
    return new vscode.Disposable(() => {
      this.watchers = Math.max(0, this.watchers - 1);
      if (this.watchers === 0 && this.pollTimer) {
        clearInterval(this.pollTimer);
        this.pollTimer = undefined;
      }
    });
  }

  async refresh(emitChanges = false): Promise<RemoteFileList> {
    if (this.refreshInFlight) return await this.refreshInFlight;
    this.refreshInFlight = this.connector
      .request<RemoteFileList>('workspace.files.list')
      .then((snapshot) => {
        const next = new Map(snapshot.entries.map((entry) => [entry.path, entry]));
        if (emitChanges) this.emitDifference(this.entries, next);
        this.entries = next;
        for (const entry of snapshot.entries) {
          if (entry.type === 'file') this.revisions.set(entry.path, entry.revision);
        }
        return snapshot;
      })
      .finally(() => {
        this.refreshInFlight = undefined;
      });
    return await this.refreshInFlight;
  }

  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    const path = relativePath(uri);
    if (!path) {
      return { type: vscode.FileType.Directory, ctime: 0, mtime: 0, size: 0 };
    }
    let entry = this.entries.get(path);
    if (!entry) {
      await this.refresh();
      entry = this.entries.get(path);
    }
    if (!entry) throw vscode.FileSystemError.FileNotFound(uri);
    return toFileStat(entry);
  }

  async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    if (this.entries.size === 0) await this.refresh();
    const root = relativePath(uri);
    const result: [string, vscode.FileType][] = [];
    for (const entry of this.entries.values()) {
      if (parentPath(entry.path) !== root) continue;
      result.push([
        baseName(entry.path),
        entry.type === 'directory' ? vscode.FileType.Directory : vscode.FileType.File,
      ]);
    }
    return result.sort(([left], [right]) => left.localeCompare(right));
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    try {
      const file = await this.connector.request<RemoteFileContent>('workspace.files.read', {
        path: relativePath(uri),
      });
      this.remember(file);
      if (file.encoding !== 'base64') {
        throw new Error(t('Connector returned an unsupported file encoding.'));
      }
      return Uint8Array.from(Buffer.from(file.data, 'base64'));
    } catch (error) {
      throw toFileSystemError(error, uri);
    }
  }

  async writeFile(
    uri: vscode.Uri,
    content: Uint8Array,
    options: { readonly create: boolean; readonly overwrite: boolean },
  ): Promise<void> {
    this.requireWrite(uri);
    const path = relativePath(uri);
    const existing = this.entries.get(path);
    if (existing && !options.overwrite) throw vscode.FileSystemError.FileExists(uri);
    if (!existing && !options.create) throw vscode.FileSystemError.FileNotFound(uri);

    const temporaryLock = !this.openDocuments.has(path);
    try {
      await this.acquireLock(path);
      const written = await this.connector.request<RemoteFileEntry>('workspace.files.write', {
        path,
        encoding: 'base64',
        data: Buffer.from(content).toString('base64'),
        expectedRevision: existing?.revision ?? this.revisions.get(path) ?? '',
      });
      this.remember(written);
      this.changed.fire([
        {
          type: existing ? vscode.FileChangeType.Changed : vscode.FileChangeType.Created,
          uri,
        },
      ]);
      void vscode.window.setStatusBarMessage(t('$(cloud-upload) KubeVS: saved {0}', path), 2_000);
    } catch (error) {
      throw toFileSystemError(error, uri);
    } finally {
      if (temporaryLock) await this.releaseLock(path);
    }
  }

  async createDirectory(uri: vscode.Uri): Promise<void> {
    this.requireWrite(uri);
    try {
      const result = await this.connector.request<RemoteFileEntry>('workspace.directories.create', {
        path: relativePath(uri),
      });
      this.remember(result);
      this.changed.fire([{ type: vscode.FileChangeType.Created, uri }]);
    } catch (error) {
      throw toFileSystemError(error, uri);
    }
  }

  async delete(uri: vscode.Uri, options: { readonly recursive: boolean }): Promise<void> {
    this.requireManage(uri);
    const path = relativePath(uri);
    try {
      await this.connector.request<RemoteMutationResult>('workspace.entries.delete', {
        path,
        recursive: options.recursive,
        expectedRevision: this.revisions.get(path) ?? '',
      });
      this.forgetTree(path);
      this.changed.fire([{ type: vscode.FileChangeType.Deleted, uri }]);
      void vscode.window.showInformationMessage(t('KubeVS: deleted from server — {0}', path));
    } catch (error) {
      throw toFileSystemError(error, uri);
    }
  }

  async rename(
    oldUri: vscode.Uri,
    newUri: vscode.Uri,
    options: { readonly overwrite: boolean },
  ): Promise<void> {
    this.requireManage(oldUri);
    const source = relativePath(oldUri);
    const destination = relativePath(newUri);
    try {
      await this.connector.request<RemoteMutationResult>('workspace.entries.rename', {
        source,
        destination,
        overwrite: options.overwrite,
        expectedRevision: this.revisions.get(source) ?? '',
      });
      this.forgetTree(source);
      await this.refresh();
      this.changed.fire([
        { type: vscode.FileChangeType.Deleted, uri: oldUri },
        { type: vscode.FileChangeType.Created, uri: newUri },
      ]);
    } catch (error) {
      throw toFileSystemError(error, oldUri);
    }
  }

  async copy(
    source: vscode.Uri,
    destination: vscode.Uri,
    options: { readonly overwrite: boolean },
  ): Promise<void> {
    this.requireManage(source);
    try {
      await this.connector.request<RemoteMutationResult>('workspace.entries.copy', {
        source: relativePath(source),
        destination: relativePath(destination),
        overwrite: options.overwrite,
      });
      await this.refresh();
      this.changed.fire([{ type: vscode.FileChangeType.Created, uri: destination }]);
    } catch (error) {
      throw toFileSystemError(error, source);
    }
  }

  async openDocument(uri: vscode.Uri): Promise<void> {
    if (!this.connector.capabilities?.workspaceWrite) return;
    const path = relativePath(uri);
    this.openDocuments.add(path);
    try {
      const lock = await this.acquireLock(path);
      void vscode.window.setStatusBarMessage(
        t('$(lock) KubeVS: {0} locked by {1}', path, lock.owner ?? t('you')),
        4_000,
      );
    } catch (error) {
      const message = messageOf(error);
      this.deniedLocks.set(path, message);
      void vscode.window.showWarningMessage(t('KubeVS: {0} opened read-only. {1}', path, message));
    }
  }

  async closeDocument(uri: vscode.Uri): Promise<void> {
    const path = relativePath(uri);
    this.openDocuments.delete(path);
    this.deniedLocks.delete(path);
    await this.releaseLock(path);
  }

  private ensurePolling(): void {
    if (this.pollTimer || this.watchers === 0) return;
    this.pollTimer = setInterval(() => {
      void this.refresh(true).catch(() => undefined);
    }, POLL_INTERVAL_MS);
  }

  private emitDifference(
    previous: ReadonlyMap<string, RemoteFileEntry>,
    next: ReadonlyMap<string, RemoteFileEntry>,
  ): void {
    const events: vscode.FileChangeEvent[] = [];
    for (const [path, entry] of next) {
      const old = previous.get(path);
      if (!old) {
        events.push({ type: vscode.FileChangeType.Created, uri: remoteUri(path) });
      } else if (
        old.revision !== entry.revision ||
        old.mtime !== entry.mtime ||
        old.type !== entry.type
      ) {
        events.push({ type: vscode.FileChangeType.Changed, uri: remoteUri(path) });
      }
    }
    for (const path of previous.keys()) {
      if (!next.has(path)) {
        events.push({ type: vscode.FileChangeType.Deleted, uri: remoteUri(path) });
      }
    }
    if (events.length > 0) this.changed.fire(events);
  }

  private remember(entry: RemoteFileEntry): void {
    this.entries.set(entry.path, entry);
    if (entry.type === 'file') this.revisions.set(entry.path, entry.revision);
  }

  private forgetTree(path: string): void {
    for (const key of [...this.entries.keys()]) {
      if (key === path || key.startsWith(`${path}/`)) this.entries.delete(key);
    }
    for (const key of [...this.revisions.keys()]) {
      if (key === path || key.startsWith(`${path}/`)) this.revisions.delete(key);
    }
  }

  private async acquireLock(path: string): Promise<RemoteLock> {
    const denied = this.deniedLocks.get(path);
    if (denied) throw vscode.FileSystemError.NoPermissions(denied);
    if (this.heldLocks.has(path)) return { path, acquired: true };
    const lock = await this.connector.request<RemoteLock>('workspace.locks.acquire', { path });
    if (!lock.acquired) {
      throw vscode.FileSystemError.NoPermissions(
        t('File is locked by {0}.', lock.owner ?? t('another team member')),
      );
    }
    this.heldLocks.add(path);
    return lock;
  }

  private async releaseLock(path: string): Promise<void> {
    if (!this.heldLocks.delete(path)) return;
    await this.connector
      .request<RemoteLock>('workspace.locks.release', { path })
      .catch(() => undefined);
  }

  private requireWrite(uri: vscode.Uri): void {
    if (!this.connector.capabilities?.workspaceWrite) {
      throw vscode.FileSystemError.NoPermissions(
        t('Role {0} allows read-only access.', this.connector.session?.role ?? 'viewer'),
      );
    }
    const denied = this.deniedLocks.get(relativePath(uri));
    if (denied) throw vscode.FileSystemError.NoPermissions(denied);
  }

  private requireManage(uri: vscode.Uri): void {
    if (!this.connector.capabilities?.workspaceManage) {
      throw vscode.FileSystemError.NoPermissions(
        t(
          'Role {0} does not allow deleting or moving files.',
          this.connector.session?.role ?? 'viewer',
        ),
      );
    }
    this.requireWrite(uri);
  }
}

function toFileStat(entry: RemoteFileEntry): vscode.FileStat {
  return {
    type: entry.type === 'directory' ? vscode.FileType.Directory : vscode.FileType.File,
    ctime: 0,
    mtime: entry.mtime,
    size: entry.size,
  };
}

function toFileSystemError(error: unknown, uri: vscode.Uri): vscode.FileSystemError {
  if (error instanceof vscode.FileSystemError) return error;
  if (error instanceof ConnectorRequestError) {
    switch (error.code) {
      case 'FILE_NOT_FOUND':
        return vscode.FileSystemError.FileNotFound(uri);
      case 'FILE_EXISTS':
        return vscode.FileSystemError.FileExists(uri);
      case 'PERMISSION_DENIED':
      case 'LOCK_REQUIRED':
        return vscode.FileSystemError.NoPermissions(error.message);
      case 'REVISION_CONFLICT':
        return vscode.FileSystemError.Unavailable(
          t(
            'The file changed on the server. Compare your unsaved changes with the new version and save again.',
          ),
        );
      default:
        return vscode.FileSystemError.Unavailable(error.message);
    }
  }
  return vscode.FileSystemError.Unavailable(messageOf(error));
}

function remoteUri(path: string): vscode.Uri {
  return vscode.Uri.from({
    scheme: SCHEME,
    authority: AUTHORITY,
    path: path ? `/${path}` : '/',
  });
}

function relativePath(uri: vscode.Uri): string {
  return decodeURIComponent(uri.path).replace(/^\/+|\/+$/gu, '');
}

function parentPath(path: string): string {
  const index = path.lastIndexOf('/');
  return index < 0 ? '' : path.slice(0, index);
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
