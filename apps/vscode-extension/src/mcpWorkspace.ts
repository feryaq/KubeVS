import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { RECIPE_PACK_MAX_BYTES } from './recipePacks.js';
import type { ConnectorClient } from './connectorClient.js';

const MAX_BYTES = 512 * 1024;
const ALLOWED = new Set(['server_scripts', 'client_scripts', 'startup_scripts', 'assets', 'data']);
type Entry = { path: string; type: 'file' | 'directory'; size?: number };
type Root = {
  id: string;
  name: string;
  remote: boolean;
  folder?: vscode.WorkspaceFolder;
  disk?: string;
};
type ReadResult = { root: string; path: string; content: string; revision: string };
type RemoteEntry = Entry & { revision: string };

function fail(message: string): never {
  throw new Error(message);
}
function cleanPath(value: string, allowRoot = false, remote = false): string {
  if (
    typeof value !== 'string' ||
    value.includes('\\') ||
    value.includes('\0') ||
    value.startsWith('/') ||
    /^[a-z][a-z\d+.-]*:/iu.test(value)
  )
    fail('Invalid workspace path');
  if (allowRoot && (value === '' || value === '.')) return '';
  const parts = value.split('/');
  if (
    parts.some(
      (part) =>
        !part ||
        part === '.' ||
        part === '..' ||
        part.includes(':') ||
        [...part].some((character) => {
          const code = character.charCodeAt(0);
          return code < 32 || code === 127;
        }),
    )
  )
    fail('Invalid workspace path');
  if (
    parts.some(
      (part, index) => part.startsWith('.') && !(index === 0 && part === '.kubevs' && !remote),
    )
  )
    fail('Hidden paths are not available');
  if (!(
    ALLOWED.has(parts[0] ?? '') ||
    (!remote &&
      parts[0] === '.kubevs' &&
      (parts[1] === undefined || ['recipe-schemas', 'recipe-packs'].includes(parts[1] ?? '')))
  ))
    fail('Path is outside KubeJS content');
  return parts.join('/');
}
function byteLimit(relative: string): number {
  return relative.startsWith('.kubevs/recipe-packs/') && relative.endsWith('.kubevs-pack.json')
    ? RECIPE_PACK_MAX_BYTES
    : MAX_BYTES;
}
function decode(bytes: Buffer, limit = MAX_BYTES): string {
  if (bytes.length > limit) fail(`File exceeds ${limit / 1024} KiB`);
  if (bytes.includes(0)) fail('Binary files are not supported');
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return fail('File is not valid UTF-8');
  }
}
function encoded(content: string, limit = MAX_BYTES): Buffer {
  if (typeof content !== 'string' || content.includes('\0')) fail('Text content is required');
  const bytes = Buffer.from(content, 'utf8');
  if (bytes.length > limit) fail(`File exceeds ${limit / 1024} KiB`);
  if (decode(bytes, limit) !== content) fail('Text content is not valid UTF-8');
  return bytes;
}
function revision(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}
function assertRevision(expected: string | null | undefined, actual: string | undefined): void {
  if (expected == null) {
    if (actual !== undefined)
      fail('File already exists; expectedRevision is required to overwrite');
  } else if (actual !== expected) fail('Revision conflict');
}
async function dirtyDocument(uri: vscode.Uri): Promise<boolean> {
  const dirty = vscode.workspace.textDocuments.filter((document) => document.isDirty);
  if (dirty.some((document) => document.uri.toString() === uri.toString())) return true;
  if (uri.scheme !== 'file') return false;
  const identity = async (file: string): Promise<string> => {
    let resolved: string;
    try {
      // VS Code may retain a Windows short path while fs.realpath expands it.
      resolved = await fs.realpath(file);
    } catch {
      try {
        resolved = path.join(await fs.realpath(path.dirname(file)), path.basename(file));
      } catch {
        resolved = path.resolve(file);
      }
    }
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  const target = await identity(uri.fsPath);
  for (const document of dirty) {
    if (document.uri.scheme === 'file' && (await identity(document.uri.fsPath)) === target)
      return true;
  }
  return false;
}

export class McpWorkspace {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly connector: ConnectorClient,
    private readonly isConnected: () => boolean,
  ) {}

  private trusted(): void {
    if (!vscode.workspace.isTrusted) fail('Workspace trust is required');
  }
  private async availableRoots(): Promise<Root[]> {
    const roots: Root[] = [];
    if (this.isConnected() && this.connector.capabilities?.workspaceFiles)
      roots.push({ id: 'server', name: 'Server KubeJS', remote: true });
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      if (folder.uri.scheme !== 'file') continue;
      const base = folder.uri.fsPath;
      let disk = base;
      if (path.basename(base).toLowerCase() !== 'kubejs') {
        const hasScripts = await Promise.all(
          [...ALLOWED].map(async (part) => {
            try {
              return (await fs.stat(path.join(base, part))).isDirectory();
            } catch {
              return false;
            }
          }),
        );
        if (!hasScripts.some(Boolean)) disk = path.join(base, 'kubejs');
      }
      roots.push({ id: `local:${folder.index}`, name: folder.name, remote: false, folder, disk });
    }
    return roots;
  }
  async roots(): Promise<readonly { id: string; name: string; remote: boolean }[]> {
    this.trusted();
    return (await this.availableRoots()).map(({ id, name, remote }) => ({ id, name, remote }));
  }
  private async choose(id?: string | undefined): Promise<Root> {
    this.trusted();
    const roots = await this.availableRoots();
    const chosen = id ? roots.find((root) => root.id === id) : roots[0];
    if (!chosen) fail('Workspace root is unavailable');
    return chosen;
  }
  private async diskPath(
    root: Root,
    relative: string,
    mode: 'existing' | 'parent' | 'createParents',
  ): Promise<string> {
    const folder = root.folder;
    // Project metadata lives beside the workspace, even when scripts are in kubejs/.
    const disk =
      relative === '.kubevs' || relative.startsWith('.kubevs/') ? folder?.uri.fsPath : root.disk;
    if (!disk || !folder) fail('Local workspace root is unavailable');
    const folderPath = folder.uri.fsPath;
    const realFolder = await fs.realpath(folderPath);
    if (disk !== folderPath && mode === 'createParents') {
      try {
        await fs.lstat(disk);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        this.trusted();
        await fs.mkdir(disk);
      }
    }
    if (disk !== folderPath) {
      const rootStat = await fs.lstat(disk);
      if (rootStat.isSymbolicLink() || !rootStat.isDirectory())
        fail('KubeJS root is not a directory');
    }
    const realRoot = await fs.realpath(disk);
    if (
      disk !== folderPath &&
      realRoot !== realFolder &&
      !realRoot.startsWith(`${realFolder}${path.sep}`)
    )
      fail('KubeJS root escapes the open folder');
    const target = path.resolve(realRoot, relative);
    if (target !== realRoot && !target.startsWith(`${realRoot}${path.sep}`))
      fail('Path escapes KubeJS root');
    const checked = mode === 'existing' ? target : path.dirname(target);
    const segments = path.relative(realRoot, checked).split(path.sep).filter(Boolean);
    let current = realRoot;
    for (const segment of segments) {
      current = path.join(current, segment);
      let stat: Awaited<ReturnType<typeof fs.lstat>>;
      try {
        stat = await fs.lstat(current);
      } catch (error) {
        if (mode !== 'createParents' || (error as NodeJS.ErrnoException).code !== 'ENOENT')
          throw error;
        this.trusted();
        try {
          await fs.mkdir(current);
        } catch (creationError) {
          if ((creationError as NodeJS.ErrnoException).code !== 'EEXIST') throw creationError;
        }
        stat = await fs.lstat(current);
      }
      if (stat.isSymbolicLink()) fail('Symbolic links are not available');
      if (!stat.isDirectory() && (mode !== 'existing' || current !== checked))
        fail('Parent is not a directory');
    }
    if (mode !== 'existing') {
      try {
        if ((await fs.lstat(target)).isSymbolicLink()) fail('Symbolic links are not available');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    return target;
  }
  private async remoteParents(relative: string, includeTarget = false): Promise<void> {
    this.remoteWriteAllowed();
    const parts = relative.split('/');
    const stop = includeTarget ? parts.length : parts.length - 1;
    for (let index = 1; index <= stop; index++) {
      const parent = parts.slice(0, index).join('/');
      const existing = (await this.remoteSnapshot()).find((entry) => entry.path === parent);
      if (existing) {
        if (existing.type !== 'directory') fail('Parent is not a directory');
        continue;
      }
      this.trusted();
      await this.connector.request('workspace.directories.create', { path: parent });
    }
  }
  private remoteReadAllowed(): void {
    if (!this.isConnected() || !this.connector.capabilities?.workspaceFiles)
      fail('Server workspace is unavailable');
  }
  private remoteWriteAllowed(manage = false): void {
    this.remoteReadAllowed();
    if (!this.connector.capabilities?.[manage ? 'workspaceManage' : 'workspaceWrite'])
      fail('Server role does not allow this operation');
  }
  private async remoteSnapshot(): Promise<readonly RemoteEntry[]> {
    this.remoteReadAllowed();
    const result = await this.connector.request<{ entries: readonly RemoteEntry[] }>(
      'workspace.files.list',
    );
    return result.entries;
  }
  private async remoteRead(relative: string): Promise<ReadResult> {
    this.remoteReadAllowed();
    const file = await this.connector.request<RemoteEntry & { encoding: string; data: string }>(
      'workspace.files.read',
      { path: relative },
    );
    if (file.type !== 'file' || file.encoding !== 'base64') fail('Unsupported server file');
    const bytes = Buffer.from(file.data, 'base64');
    return { root: 'server', path: relative, content: decode(bytes), revision: file.revision };
  }
  private async localRead(root: Root, relative: string): Promise<ReadResult> {
    const target = await this.diskPath(root, relative, 'existing');
    if (!(await fs.lstat(target)).isFile()) fail('Path is not a file');
    const stat = await fs.stat(target);
    if (stat.size > byteLimit(relative)) fail(`File exceeds ${byteLimit(relative) / 1024} KiB`);
    const bytes = await fs.readFile(target);
    return {
      root: root.id,
      path: relative,
      content: decode(bytes, byteLimit(relative)),
      revision: revision(bytes),
    };
  }
  async list(
    args: {
      root?: string | undefined;
      path?: string | undefined;
      offset?: number | undefined;
      limit?: number | undefined;
    } = {},
  ): Promise<{
    root: string;
    path: string;
    entries: readonly Entry[];
    total: number;
    hasMore: boolean;
  }> {
    const root = await this.choose(args.root);
    const relative = cleanPath(args.path ?? '', true, root.remote);
    const offset = args.offset ?? 0,
      limit = args.limit ?? 100;
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 500
    )
      fail('Invalid list page');
    let entries: Entry[];
    if (root.remote) {
      const all = await this.remoteSnapshot();
      entries = all
        .filter((entry) => {
          try {
            cleanPath(entry.path, false, true);
          } catch {
            return false;
          }
          return path.posix.dirname(entry.path) === (relative || '.');
        })
        .map(({ path: p, type, size }) =>
          type === 'file' && size !== undefined ? { path: p, type, size } : { path: p, type },
        );
    } else {
      const base = await this.diskPath(root, relative, 'existing');
      entries = [];
      for (const dirent of await fs.readdir(base, { withFileTypes: true })) {
        const child = relative ? `${relative}/${dirent.name}` : dirent.name;
        try {
          cleanPath(child);
        } catch {
          continue;
        }
        if (dirent.isSymbolicLink()) continue;
        if (dirent.isDirectory()) entries.push({ path: child, type: 'directory' });
        else if (dirent.isFile())
          entries.push({
            path: child,
            type: 'file',
            size: (await fs.stat(path.join(base, dirent.name))).size,
          });
      }
    }
    entries.sort((a, b) => a.path.localeCompare(b.path));
    return {
      root: root.id,
      path: relative,
      entries: entries.slice(offset, offset + limit),
      total: entries.length,
      hasMore: offset + limit < entries.length,
    };
  }
  async read(args: { root?: string | undefined; path: string }): Promise<ReadResult> {
    const root = await this.choose(args.root),
      relative = cleanPath(args.path, false, root.remote);
    return root.remote ? this.remoteRead(relative) : this.localRead(root, relative);
  }
  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task, task);
    this.queue = result.catch(() => undefined);
    return result;
  }
  private async serverLock<T>(relative: string, task: () => Promise<T>): Promise<T> {
    const prior = await this.connector.request<{ ownerSessionId?: string }>(
      'workspace.locks.status',
      { path: relative },
    );
    const lock = await this.connector.request<{ acquired?: boolean; ownerSessionId?: string }>(
      'workspace.locks.acquire',
      { path: relative },
    );
    if (!lock.acquired) fail('File is locked');
    const ownedBefore = !!prior.ownerSessionId && prior.ownerSessionId === lock.ownerSessionId;
    try {
      return await task();
    } finally {
      if (!ownedBefore)
        await this.connector
          .request('workspace.locks.release', { path: relative })
          .catch(() => undefined);
    }
  }
  async write(args: {
    root?: string | undefined;
    path: string;
    content: string;
    expectedRevision?: string | null | undefined;
  }): Promise<ReadResult> {
    return this.serialize(async () => {
      const root = await this.choose(args.root),
        relative = cleanPath(args.path, false, root.remote),
        bytes = encoded(args.content, root.remote ? MAX_BYTES : byteLimit(relative));
      if (root.remote) {
        this.remoteWriteAllowed();
        if (
          await dirtyDocument(
            vscode.Uri.from({ scheme: 'kubevs-remote', authority: 'server', path: `/${relative}` }),
          )
        )
          fail('Open document has unsaved changes');
        return this.serverLock(relative, async () => {
          const existing = (await this.remoteSnapshot()).find((entry) => entry.path === relative);
          if (existing && existing.type !== 'file') fail('Path is not a file');
          assertRevision(args.expectedRevision, existing?.revision);
          await this.remoteParents(relative);
          this.trusted();
          const written = await this.connector.request<RemoteEntry>('workspace.files.write', {
            path: relative,
            encoding: 'base64',
            data: bytes.toString('base64'),
            expectedRevision: existing?.revision ?? '',
          });
          return {
            root: root.id,
            path: relative,
            content: args.content,
            revision: written.revision,
          };
        });
      }
      const target = await this.diskPath(root, relative, 'createParents');
      if (await dirtyDocument(vscode.Uri.file(target))) fail('Open document has unsaved changes');
      let current: Buffer | undefined;
      try {
        current = await fs.readFile(target);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      if (current) decode(current, byteLimit(relative));
      assertRevision(args.expectedRevision, current ? revision(current) : undefined);
      const temp = path.join(
        path.dirname(target),
        `.kubevs-mcp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      );
      try {
        await fs.writeFile(temp, bytes, { flag: 'wx' });
        this.trusted();
        if (!current) await fs.link(temp, target);
        else {
          const latest = await fs.readFile(target);
          assertRevision(args.expectedRevision, revision(latest));
          this.trusted();
          await fs.rename(temp, target);
        }
      } finally {
        await fs.rm(temp, { force: true });
      }
      return { root: root.id, path: relative, content: args.content, revision: revision(bytes) };
    });
  }
  async delete(args: {
    root?: string | undefined;
    path: string;
    expectedRevision: string;
  }): Promise<{ deleted: true; root: string; path: string }> {
    return this.serialize(async () => {
      const root = await this.choose(args.root),
        relative = cleanPath(args.path, false, root.remote);
      if (typeof args.expectedRevision !== 'string' || !args.expectedRevision)
        fail('expectedRevision is required');
      if (root.remote) {
        this.remoteWriteAllowed(true);
        if (
          await dirtyDocument(
            vscode.Uri.from({ scheme: 'kubevs-remote', authority: 'server', path: `/${relative}` }),
          )
        )
          fail('Open document has unsaved changes');
        await this.serverLock(relative, async () => {
          const file = await this.remoteRead(relative);
          assertRevision(args.expectedRevision, file.revision);
          this.trusted();
          await this.connector.request('workspace.entries.delete', {
            path: relative,
            recursive: false,
            expectedRevision: file.revision,
          });
        });
      } else {
        const target = await this.diskPath(root, relative, 'existing');
        if (await dirtyDocument(vscode.Uri.file(target))) fail('Open document has unsaved changes');
        const file = await this.localRead(root, relative);
        assertRevision(args.expectedRevision, file.revision);
        this.trusted();
        await fs.unlink(target);
      }
      return { deleted: true, root: root.id, path: relative };
    });
  }
  async mkdir(args: { root?: string | undefined; path: string }): Promise<unknown> {
    return this.serialize(async () => {
      const root = await this.choose(args.root),
        relative = cleanPath(args.path, false, root.remote);
      if (root.remote) {
        await this.remoteParents(relative, true);
        return { root: root.id, path: relative, created: true };
      }
      const target = await this.diskPath(root, relative, 'createParents');
      try {
        this.trusted();
        await fs.mkdir(target);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        const stat = await fs.lstat(target);
        if (stat.isSymbolicLink() || !stat.isDirectory()) fail('Path is not a directory');
      }
      return { root: root.id, path: relative, created: true };
    });
  }
  async move(args: {
    root?: string | undefined;
    path: string;
    destination: string;
    expectedRevision: string;
    copy?: boolean | undefined;
  }): Promise<unknown> {
    return this.serialize(async () => {
      const root = await this.choose(args.root),
        source = cleanPath(args.path, false, root.remote),
        destination = cleanPath(args.destination, false, root.remote);
      if (source === destination || !args.expectedRevision) fail('Invalid move');
      if (root.remote) {
        this.remoteWriteAllowed(true);
        for (const p of [source, destination])
          if (
            await dirtyDocument(
              vscode.Uri.from({ scheme: 'kubevs-remote', authority: 'server', path: `/${p}` }),
            )
          )
            fail('Open document has unsaved changes');
        return this.serverLock(source, async () => {
          const file = await this.remoteRead(source);
          assertRevision(args.expectedRevision, file.revision);
          const existing = (await this.remoteSnapshot()).some(
            (entry) => entry.path === destination,
          );
          if (existing) fail('Destination already exists');
          await this.remoteParents(destination);
          this.trusted();
          return this.connector.request(
            args.copy ? 'workspace.entries.copy' : 'workspace.entries.rename',
            { source, destination, overwrite: false, expectedRevision: file.revision },
          );
        });
      }
      const from = await this.diskPath(root, source, 'existing');
      if (await dirtyDocument(vscode.Uri.file(from))) fail('Open document has unsaved changes');
      const file = await this.localRead(root, source);
      assertRevision(args.expectedRevision, file.revision);
      const to = await this.diskPath(root, destination, 'createParents');
      if (await dirtyDocument(vscode.Uri.file(to))) fail('Open document has unsaved changes');
      try {
        await fs.lstat(to);
        fail('Destination already exists');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      this.trusted();
      if (args.copy) await fs.copyFile(from, to, fs.constants.COPYFILE_EXCL);
      else {
        await fs.link(from, to);
        await fs.unlink(from);
      }
      return { root: root.id, path: source, destination, copied: !!args.copy };
    });
  }
}
