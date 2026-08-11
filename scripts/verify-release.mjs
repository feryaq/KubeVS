import { existsSync, readFileSync } from 'node:fs';
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
const packageNlsRu = json('apps/vscode-extension/package.nls.ru.json');

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
if (rootPackage.license !== 'UNLICENSED') errors.push('Root package must be UNLICENSED');
if (extensionPackage.license !== 'SEE LICENSE IN LICENSE') {
  errors.push('Extension must reference its commercial LICENSE file');
}
if (existsSync(resolve(root, 'apps/vscode-extension/media/pixel'))) {
  errors.push('Unlicensed user-supplied pixel assets are present');
}
if (extensionPackage.l10n !== './l10n') errors.push('Extension l10n bundle is not configured');
if (!existsSync(resolve(root, 'apps/vscode-extension/media/kubevs-logo.png'))) {
  errors.push('KubeVS logo asset is missing');
}
if (!packageNls['command.connectWithCode'] || !packageNlsRu['command.connectWithCode']) {
  errors.push('English and Russian manifest localizations are required');
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
