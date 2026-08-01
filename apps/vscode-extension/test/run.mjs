import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTests } from '@vscode/test-electron';

const directory = path.dirname(fileURLToPath(import.meta.url));
const localExecutable = process.env.KUBEVS_VSCODE_EXECUTABLE_PATH;

try {
  const options = {
    extensionDevelopmentPath: path.resolve(directory, '..'),
    extensionTestsPath: path.resolve(directory, 'suite', 'index.cjs'),
    launchArgs: [path.resolve(directory, '../../../examples/basic-kubejs'), '--disable-extensions'],
  };
  if (localExecutable) options.vscodeExecutablePath = localExecutable;
  else options.version = '1.105.1';
  await runTests(options);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
