import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTests } from '@vscode/test-electron';
import { WebSocketServer } from 'ws';

const directory = path.dirname(fileURLToPath(import.meta.url));
const localExecutable = process.env.KUBEVS_VSCODE_EXECUTABLE_PATH;
const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kubevs-vscode-test-'));
const token = 'T'.repeat(43);
const entries = new Map();
let clock = Date.now();

for (const folder of ['server_scripts', 'client_scripts', 'startup_scripts', 'assets']) {
  entries.set(folder, { type: 'directory', data: Buffer.alloc(0), mtime: clock++ });
}

const revision = (data) => createHash('sha256').update(data).digest('hex');
const entryJson = (entryPath, entry) => ({
  path: entryPath,
  type: entry.type,
  size: entry.type === 'file' ? entry.data.length : 0,
  mtime: entry.mtime,
  revision: entry.type === 'file' ? revision(entry.data) : '',
});
const parent = (entryPath) => entryPath.slice(0, Math.max(0, entryPath.lastIndexOf('/')));
const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
await new Promise((resolve) => server.once('listening', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('Mock Connector did not bind');
process.env.KUBEVS_TEST_CONNECTOR_PORT = String(address.port);
process.env.KUBEVS_TEST_CONNECTOR_TOKEN = token;

const respond = (socket, requestId, result) =>
  socket.send(JSON.stringify({ type: 'response', requestId, ok: true, result }));
const sendEvent = (socket, change, entryPath) =>
  socket.send(
    JSON.stringify({
      type: 'event',
      event: 'workspace.changed',
      data: { change, path: entryPath, actor: 'MockServer' },
    }),
  );

server.on('connection', (socket, request) => {
  if (request.headers.authorization !== `Bearer ${token}`) {
    socket.close(1008, 'Authentication failed');
    return;
  }
  socket.send(
    JSON.stringify({
      type: 'hello',
      protocolVersion: 2,
      connectorVersion: 'test',
      minecraftVersion: '1.21.1',
      kubejsVersion: 'test',
      session: {
        kind: 'player',
        displayName: 'IntegrationTest',
        sessionId: '123e4567-e89b-42d3-a456-426614174000',
        role: 'editor',
        permissionLevel: 2,
        permissions: ['kubevs.workspace.read', 'kubevs.workspace.write', 'kubevs.workspace.manage'],
      },
      workspace: { instancePath: '/mock', kubejsPath: '/mock/kubejs' },
      capabilities: {
        registries: true,
        recipes: true,
        logs: false,
        reload: false,
        inspect: false,
        integrations: [],
        workspaceFiles: true,
        workspaceLocks: true,
        workspaceWrite: true,
        workspaceManage: true,
        workspaceMaxFileBytes: 4_194_304,
      },
    }),
  );

  socket.on('message', (payload) => {
    const requestMessage = JSON.parse(payload.toString());
    const { method, params = {}, requestId } = requestMessage;
    if (method === 'registry.items' || method === 'registry.tags' || method === 'recipes.list') {
      respond(socket, requestId, { entries: [], offset: 0, total: 0, hasMore: false });
      return;
    }
    if (method === 'mods.list') {
      respond(socket, requestId, { entries: [], total: 0 });
      return;
    }
    if (method === 'workspace.files.list') {
      respond(socket, requestId, {
        entries: [...entries].map(([entryPath, entry]) => entryJson(entryPath, entry)),
        total: entries.size,
      });
      return;
    }
    if (method === 'workspace.files.read') {
      const entry = entries.get(params.path);
      respond(socket, requestId, {
        ...entryJson(params.path, entry),
        encoding: 'base64',
        data: entry.data.toString('base64'),
      });
      return;
    }
    if (method === 'workspace.locks.acquire') {
      respond(socket, requestId, {
        path: params.path,
        acquired: true,
        owner: 'IntegrationTest',
        ownerSessionId: 'test-session',
      });
      return;
    }
    if (method === 'workspace.locks.release') {
      respond(socket, requestId, { path: params.path, released: true });
      return;
    }
    if (method === 'workspace.locks.list') {
      respond(socket, requestId, { entries: [], total: 0 });
      return;
    }
    if (method === 'workspace.files.write') {
      const data = Buffer.from(params.data, 'base64');
      const entry = { type: 'file', data, mtime: clock++ };
      entries.set(params.path, entry);
      respond(socket, requestId, entryJson(params.path, entry));
      sendEvent(socket, 'changed', params.path);
      return;
    }
    if (method === 'workspace.directories.create') {
      const entry = { type: 'directory', data: Buffer.alloc(0), mtime: clock++ };
      entries.set(params.path, entry);
      respond(socket, requestId, entryJson(params.path, entry));
      sendEvent(socket, 'created', params.path);
      return;
    }
    if (method === 'workspace.entries.delete') {
      for (const key of [...entries.keys()]) {
        if (key === params.path || key.startsWith(`${params.path}/`)) entries.delete(key);
      }
      respond(socket, requestId, {});
      sendEvent(socket, 'deleted', params.path);
      return;
    }
    if (method === 'workspace.entries.rename' || method === 'workspace.entries.copy') {
      const sourceEntries = [...entries].filter(
        ([key]) => key === params.source || key.startsWith(`${params.source}/`),
      );
      for (const [key, entry] of sourceEntries) {
        const target = params.destination + key.slice(params.source.length);
        entries.set(target, {
          type: entry.type,
          data: Buffer.from(entry.data),
          mtime: clock++,
        });
        if (method === 'workspace.entries.rename') entries.delete(key);
      }
      respond(socket, requestId, {});
      sendEvent(socket, method.endsWith('rename') ? 'renamed' : 'created', params.destination);
      return;
    }
    socket.send(
      JSON.stringify({
        type: 'error',
        requestId,
        code: 'INVALID_MESSAGE',
        message: `Unsupported mock method: ${method}`,
      }),
    );
  });
});

try {
  const options = {
    extensionDevelopmentPath: path.resolve(directory, '..'),
    extensionTestsPath: path.resolve(directory, 'suite', 'index.cjs'),
    launchArgs: [
      path.resolve(directory, '../../../examples/basic-kubejs'),
      '--disable-extensions',
      '--user-data-dir',
      userDataDir,
    ],
  };
  if (localExecutable) options.vscodeExecutablePath = localExecutable;
  else options.version = '1.105.1';
  await runTests(options);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  for (const socket of server.clients) socket.terminate();
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(userDataDir, { recursive: true, force: true });
}
