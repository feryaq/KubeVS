import * as vscode from 'vscode';
import { connectorCredentialKey, parseConnectorToken } from './connectorAuthCore.js';

export type ConnectorTokenSource = 'stored' | 'discovered' | 'selected' | 'pasted';

export interface ConnectorCredentials {
  readonly token: string;
  readonly secretKey: string;
  readonly legacySecretKey: string;
  readonly source: ConnectorTokenSource;
}

export interface ConnectorCredentialOptions {
  readonly host: string;
  readonly port: number;
  readonly legacyProfile: string;
  readonly interactive: boolean;
  readonly forceSelection?: boolean;
}

interface TokenChoice extends vscode.QuickPickItem {
  readonly action: 'file' | 'browse' | 'paste';
  readonly uri?: vscode.Uri;
}

const TOKEN_FILENAME = 'kubevs-connector-token.txt';

export async function resolveConnectorCredentials(
  context: vscode.ExtensionContext,
  options: ConnectorCredentialOptions,
): Promise<ConnectorCredentials | undefined> {
  const secretKey = connectorCredentialKey(options.host, options.port);
  const legacySecretKey = `kubevs.connector.token.${options.legacyProfile}`;
  if (!options.forceSelection) {
    const stored =
      (await context.secrets.get(secretKey)) ?? (await context.secrets.get(legacySecretKey));
    if (stored) {
      return {
        token: parseConnectorToken(stored),
        secretKey,
        legacySecretKey,
        source: 'stored',
      };
    }
  }

  const discovered = vscode.workspace.isTrusted ? await discoverTokenFiles() : [];
  if (!options.forceSelection && discovered.length === 1) {
    return {
      token: await readTokenFile(discovered[0] as vscode.Uri),
      secretKey,
      legacySecretKey,
      source: 'discovered',
    };
  }
  if (!options.interactive) return undefined;

  const choice = await chooseTokenSource(discovered);
  if (!choice) return undefined;
  if (choice.action === 'paste') {
    const token = await pasteToken();
    return token ? { token, secretKey, legacySecretKey, source: 'pasted' } : undefined;
  }

  const defaultUri = vscode.workspace.workspaceFolders?.[0]?.uri;
  const uri =
    choice.action === 'file'
      ? choice.uri
      : (
          await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            ...(defaultUri ? { defaultUri } : {}),
            filters: { 'KubeVS Connector token': ['txt'] },
            openLabel: 'Use token file',
            title: 'Select kubevs-connector-token.txt',
          })
        )?.[0];
  if (!uri) return undefined;
  return {
    token: await readTokenFile(uri),
    secretKey,
    legacySecretKey,
    source: 'selected',
  };
}

export async function storeConnectorCredentials(
  context: vscode.ExtensionContext,
  credentials: ConnectorCredentials,
): Promise<void> {
  await context.secrets.store(credentials.secretKey, credentials.token);
  if (credentials.legacySecretKey !== credentials.secretKey) {
    await context.secrets.delete(credentials.legacySecretKey);
  }
}

export async function forgetConnectorCredentials(
  context: vscode.ExtensionContext,
  options: Pick<ConnectorCredentialOptions, 'host' | 'port' | 'legacyProfile'>,
): Promise<void> {
  await Promise.all([
    context.secrets.delete(connectorCredentialKey(options.host, options.port)),
    context.secrets.delete(`kubevs.connector.token.${options.legacyProfile}`),
  ]);
}

async function chooseTokenSource(
  discovered: readonly vscode.Uri[],
): Promise<TokenChoice | undefined> {
  const detected: TokenChoice[] = discovered.map((uri) => ({
    label: '$(file-key) Use detected token',
    description: vscode.workspace.asRelativePath(uri),
    detail: uri.toString(true),
    action: 'file',
    uri,
  }));
  const actions: TokenChoice[] = [
    {
      label: '$(folder-opened) Choose token file…',
      description: 'Recommended for a local Minecraft instance',
      action: 'browse',
    },
    {
      label: '$(key) Paste token…',
      description: 'For a remote or dedicated server',
      action: 'paste',
    },
  ];
  return await vscode.window.showQuickPick([...detected, ...actions], {
    ignoreFocusOut: true,
    matchOnDescription: true,
    matchOnDetail: true,
    placeHolder:
      discovered.length > 1
        ? 'Choose the Minecraft instance to connect'
        : 'Choose how to authorize KubeVS Connector',
    title: 'Connect KubeVS to Minecraft',
  });
}

async function pasteToken(): Promise<string | undefined> {
  const value = await vscode.window.showInputBox({
    ignoreFocusOut: true,
    password: true,
    prompt: `Paste the value from config/${TOKEN_FILENAME}.`,
    title: 'Paste KubeVS Connector token',
    validateInput: (input) => {
      try {
        parseConnectorToken(input);
        return undefined;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    },
  });
  return value === undefined ? undefined : parseConnectorToken(value);
}

async function discoverTokenFiles(): Promise<vscode.Uri[]> {
  const candidates = new Map<string, vscode.Uri>();
  const found = await vscode.workspace.findFiles(
    `**/config/${TOKEN_FILENAME}`,
    '**/{node_modules,.git,build}/**',
    20,
  );
  found.forEach((uri) => candidates.set(uri.toString(), uri));

  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const name = folder.uri.path.split('/').filter(Boolean).at(-1)?.toLowerCase();
    const probes = [vscode.Uri.joinPath(folder.uri, 'config', TOKEN_FILENAME)];
    if (name === 'kubejs') {
      probes.push(vscode.Uri.joinPath(folder.uri, '..', 'config', TOKEN_FILENAME));
    } else if (name && ['server_scripts', 'client_scripts', 'startup_scripts'].includes(name)) {
      probes.push(vscode.Uri.joinPath(folder.uri, '..', '..', 'config', TOKEN_FILENAME));
    }
    for (const uri of probes) {
      if (await fileExists(uri)) candidates.set(uri.toString(), uri);
    }
  }
  return [...candidates.values()].sort((left, right) =>
    left.toString().localeCompare(right.toString()),
  );
}

async function readTokenFile(uri: vscode.Uri): Promise<string> {
  const bytes = await vscode.workspace.fs.readFile(uri);
  if (bytes.byteLength > 4096) throw new Error('Connector token file is unexpectedly large.');
  return parseConnectorToken(new TextDecoder().decode(bytes));
}

async function fileExists(uri: vscode.Uri): Promise<boolean> {
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    return (stat.type & vscode.FileType.File) !== 0;
  } catch {
    return false;
  }
}
