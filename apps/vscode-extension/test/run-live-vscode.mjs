import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { runTests } from '@vscode/test-electron';

const directory = path.dirname(fileURLToPath(import.meta.url));
const tokenFile = process.env.KUBEVS_TOKEN_FILE;
const connectorUrl = new URL(process.env.KUBEVS_URL || 'ws://127.0.0.1:32145');
if (!tokenFile) throw new Error('KUBEVS_TOKEN_FILE is required');
if (!['ws:', 'wss:'].includes(connectorUrl.protocol))
  throw new Error('KUBEVS_URL must use ws:// or wss://');
const token = (await fs.readFile(tokenFile, 'utf8')).trim();
const port = connectorUrl.port || (connectorUrl.protocol === 'wss:' ? '443' : '80');
const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kubevs-vscode-live-'));
const workspaceFile = path.join(userDataDir, 'kubevs-live.code-workspace');
await fs.writeFile(
  workspaceFile,
  JSON.stringify({
    folders: [
      { path: path.resolve(directory, '../../../examples/basic-kubejs') },
      { uri: 'kubevs-remote://server/', name: 'KubeJS — live server' },
    ],
  }),
  'utf8',
);
process.env.KUBEVS_LIVE_CODE = `kubevs://${connectorUrl.hostname}:${port}?token=${encodeURIComponent(token)}&secure=${connectorUrl.protocol === 'wss:'}`;

try {
  const options = {
    extensionDevelopmentPath: path.resolve(directory, '..'),
    extensionTestsPath: path.resolve(directory, 'suite', 'liveConnector.index.cjs'),
    launchArgs: [workspaceFile, '--disable-extensions', '--user-data-dir', userDataDir],
  };
  if (process.env.KUBEVS_VSCODE_EXECUTABLE_PATH) {
    options.vscodeExecutablePath = process.env.KUBEVS_VSCODE_EXECUTABLE_PATH;
  } else {
    options.version = '1.105.1';
  }
  await runTests(options);
} finally {
  delete process.env.KUBEVS_LIVE_CODE;
  await fs.rm(userDataDir, { recursive: true, force: true });
}
