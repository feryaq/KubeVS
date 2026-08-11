import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const json = (path) => JSON.parse(readFileSync(resolve(root, path), 'utf8'));
const rootPackage = json('package.json');
const extensionPackage = json('apps/vscode-extension/package.json');
const gradle = readFileSync(resolve(root, 'gradle.properties'), 'utf8');
const changelog = readFileSync(resolve(root, 'CHANGELOG.md'), 'utf8');
const connectorVersion = gradle.match(/^mod_version=(.+)$/m)?.[1]?.trim();
const protocol = readFileSync(resolve(root, 'packages/protocol/src/index.ts'), 'utf8');
const protocolVersion = protocol.match(/PROTOCOL_VERSION = (\d+)/)?.[1];
const connectorBuild = readFileSync(resolve(root, 'mods/kubevs-connector/build.gradle'), 'utf8');
const packageNls = json('apps/vscode-extension/package.nls.json');
const errors = [];
if (rootPackage.version !== extensionPackage.version) {
  errors.push(
    `Root version ${rootPackage.version} differs from extension ${extensionPackage.version}`,
  );
}
if (!connectorVersion) errors.push('Connector version is missing from gradle.properties');
if (connectorVersion && connectorVersion !== extensionPackage.version) {
  errors.push(
    `Connector version ${connectorVersion} differs from extension ${extensionPackage.version}`,
  );
}
if (protocolVersion !== '2')
  errors.push('Production protocol must be 2, got ' + (protocolVersion ?? 'missing'));
if (rootPackage.license !== 'SEE LICENSE IN LICENSE') {
  errors.push('Root package must reference the repository LICENSE file');
}
if (extensionPackage.license !== 'SEE LICENSE IN LICENSE') {
  errors.push('Extension must reference its Community Source LICENSE file');
}
if (existsSync(resolve(root, 'apps/vscode-extension/media/pixel'))) {
  errors.push('Unlicensed user-supplied pixel assets are present');
}
if (!existsSync(resolve(root, 'apps/vscode-extension/media/kubevs-logo.png'))) {
  errors.push('KubeVS logo asset is missing');
}
if (!packageNls['command.connectWithCode']) {
  errors.push('English manifest localization is required');
}
const extensionRoot = resolve(root, 'apps/vscode-extension');
const ignoredDirectories = new Set(['node_modules', 'dist', '.vscode-test']);
const textExtensions = new Set([
  '.ts',
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.md',
  '.html',
  '.css',
  '.yml',
  '.yaml',
]);
const extensionTextFiles = [];
const visit = (directory) => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) visit(path);
    else if ([...textExtensions].some((extension) => entry.name.endsWith(extension))) {
      extensionTextFiles.push(path);
    }
  }
};
visit(extensionRoot);
for (const path of extensionTextFiles) {
  const content = readFileSync(path, 'utf8');
  if (/[А-Яа-яЁё]/u.test(content)) {
    errors.push(
      'Extension must be English-only; Cyrillic text found in ' + path.slice(root.length + 1),
    );
  }
}
if (existsSync(resolve(extensionRoot, 'package.nls.ru.json'))) {
  errors.push('Russian manifest localization must not be packaged');
}
if (existsSync(resolve(extensionRoot, 'l10n/bundle.l10n.ru.json'))) {
  errors.push('Russian runtime localization must not be packaged');
}
const publicMetadata = [
  readFileSync(resolve(root, 'README.md'), 'utf8'),
  readFileSync(resolve(extensionRoot, 'README.md'), 'utf8'),
  JSON.stringify(extensionPackage),
].join('\n');
if (/(?:created|made) by\s+f|telegram|discord|t\.me\//iu.test(publicMetadata)) {
  errors.push('Public extension metadata must not contain creator or social promotion');
}
if (/ProGuard|obfuscatedJar|guardsquare/u.test(connectorBuild)) {
  errors.push('Connector production build must not use binary obfuscation');
}
const heading = `## [${extensionPackage.version} / Connector ${connectorVersion}]`;
if (!changelog.includes(heading)) errors.push(`CHANGELOG is missing ${heading}`);

if (errors.length) {
  for (const error of errors) console.error(`ERROR: ${error}`);
  process.exit(1);
}
console.log(
  `Release metadata OK: KubeVS ${extensionPackage.version}, Connector ${connectorVersion}`,
);
