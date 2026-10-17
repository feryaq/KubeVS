import * as vscode from 'vscode';
import { DashboardController, type DashboardSnapshot } from './dashboard.js';
import { openRegistryBrowser } from './registryBrowser.js';
import { importRecipeFile } from './recipeImport.js';
import { openAddonRecipeEditor, saveAddonRecipeDraft } from './addonRecipeEditor.js';
import { isAddonRecipeDraft } from './addonRecipeCore.js';
import { analyzeKubeJs, classifyScriptPath, type ScriptKind } from '@kubevs/kubejs-parser';
import {
  PROTOCOL_VERSION,
  type ConnectorHello,
  type ModSnapshot,
  type PagedIds,
  isConnectorStatus,
  type ConnectorStatus,
} from '@kubevs/protocol';
import {
  forgetConnectorCredentials,
  resolveConnectorCredentials,
  storeConnectorCredentials,
  type ConnectorCredentials,
} from './connectorAuth.js';
import {
  connectorCredentialKey,
  isConnectorAuthenticationError,
  describeConnectorConnectionError,
  parseConnectorConnectionCode,
} from './connectorAuthCore.js';
import { ConnectorClient } from './connectorClient.js';
import { openContentBuilder } from './contentBuilder.js';
import { loadRecipes, openCraftGraph } from './craftGraph.js';
import { registerDataTools } from './dataTools.js';
import { createRecipeSchema, openGenericRecipeEditor } from './genericRecipeEditor.js';
import { registerLanguageSupport } from './languageSupport.js';
import { openLootRuleEditor } from './lootRuleEditor.js';
import { openRecipeEditor, saveVanillaRecipeDraft } from './recipeEditor.js';
import { registerRecipeManagement } from './recipeManagement.js';
import { registerRecipeReplacement } from './recipeReplacement.js';
import { registerRemoteWorkspace } from './remoteWorkspace.js';
import { RegistryCatalog } from './registryCatalog.js';
import { registerRegistryCompletion } from './registryCompletion.js';
import { bootstrapConnectorWorkspace } from './workspaceBootstrap.js';
import { fileCount, setRuntimeLocale, t } from './localization.js';
import { McpController } from './mcpController.js';
import { McpWorkspace } from './mcpWorkspace.js';

type ConnectionState = 'offline' | 'connecting' | 'connected' | 'error';

interface LiveStats {
  readonly items: number;
  readonly tags: number;
  readonly recipes: number;
  readonly mods: number;
}

interface ConnectorLogSnapshot {
  readonly entries: readonly {
    readonly timestamp: string;
    readonly level: string;
    readonly category: string;
    readonly message: string;
  }[];
}

class LogChannels implements vscode.Disposable {
  readonly main = vscode.window.createOutputChannel('KubeVS', { log: true });
  readonly connector = vscode.window.createOutputChannel('KubeVS Connector', { log: true });
  readonly importer = vscode.window.createOutputChannel('KubeVS Import', { log: true });
  readonly generator = vscode.window.createOutputChannel('KubeVS Generator', { log: true });

  dispose(): void {
    this.main.dispose();
    this.connector.dispose();
    this.importer.dispose();
    this.generator.dispose();
  }
}

class ProjectItem extends vscode.TreeItem {
  constructor(
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    readonly uri?: vscode.Uri,
    readonly kind?: ScriptKind,
  ) {
    super(label, collapsibleState);
    if (uri) {
      this.resourceUri = uri;
      this.command = {
        command: 'vscode.open',
        title: 'Open script',
        arguments: [uri],
      };
      this.contextValue = 'kubevsScript';
    }
  }
}

class ProjectProvider implements vscode.TreeDataProvider<ProjectItem> {
  private readonly changed = new vscode.EventEmitter<ProjectItem | undefined | null>();
  readonly onDidChangeTreeData = this.changed.event;
  private scripts = new Map<ScriptKind, readonly vscode.Uri[]>();

  async refresh(includeRemote = false): Promise<void> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const localFolders = folders.filter((folder) => folder.uri.scheme !== 'kubevs-remote');
    const remoteFolders = includeRemote
      ? folders.filter((folder) => folder.uri.scheme === 'kubevs-remote')
      : [];
    const [localBatches, remoteBatches] = await Promise.all([
      Promise.all(
        localFolders.map((folder) =>
          vscode.workspace.findFiles(
            new vscode.RelativePattern(
              folder,
              '**/{server_scripts,client_scripts,startup_scripts}/**/*.{js,ts}',
            ),
            '**/{node_modules,.git,build}/**',
            5000,
          ),
        ),
      ),
      Promise.all(remoteFolders.map((folder) => collectRemoteScripts(folder.uri, 5000))),
    ]);
    const files = [
      ...new Map(
        [...localBatches, ...remoteBatches].flat().map((uri) => [uri.toString(), uri]),
      ).values(),
    ];
    const grouped = new Map<ScriptKind, vscode.Uri[]>([
      ['server_scripts', []],
      ['client_scripts', []],
      ['startup_scripts', []],
    ]);
    for (const file of files) {
      const kind = classifyScriptPath(file.fsPath);
      if (kind) grouped.get(kind)?.push(file);
    }
    this.scripts = grouped;
    this.changed.fire(undefined);
  }

  getTreeItem(element: ProjectItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: ProjectItem): ProjectItem[] {
    if (!element) {
      return [...this.scripts.entries()]
        .filter(([, files]) => files.length > 0)
        .map(([kind, files]) => {
          const item = new ProjectItem(
            displayKind(kind),
            vscode.TreeItemCollapsibleState.Expanded,
            undefined,
            kind,
          );
          item.description = fileCount(files.length);
          item.tooltip = scriptKindTooltip(kind);
          item.iconPath = new vscode.ThemeIcon('files');
          return item;
        });
    }
    const kind = element.kind;
    if (!kind) return [];
    return (this.scripts.get(kind) ?? []).map(
      (uri) =>
        new ProjectItem(
          vscode.workspace.asRelativePath(uri),
          vscode.TreeItemCollapsibleState.None,
          uri,
        ),
    );
  }

  get files(): readonly vscode.Uri[] {
    return [...this.scripts.values()].flat();
  }

  get count(): number {
    return [...this.scripts.values()].reduce((sum, files) => sum + files.length, 0);
  }
}

async function collectRemoteScripts(root: vscode.Uri, limit: number): Promise<vscode.Uri[]> {
  const files: vscode.Uri[] = [];
  const pending = [root];
  const excluded = new Set(['.git', '.vscode', 'build', 'node_modules']);
  while (pending.length > 0 && files.length < limit) {
    const directory = pending.pop();
    if (!directory) break;
    for (const [name, type] of await vscode.workspace.fs.readDirectory(directory)) {
      if (excluded.has(name)) continue;
      const uri = vscode.Uri.joinPath(directory, name);
      if ((type & vscode.FileType.Directory) !== 0) {
        pending.push(uri);
      } else if (/\.(?:js|ts)$/iu.test(name) && classifyScriptPath(uri.path)) {
        files.push(uri);
        if (files.length >= limit) break;
      }
    }
  }
  return files;
}

class DiagnosticsController implements vscode.Disposable {
  private readonly collection = vscode.languages.createDiagnosticCollection('kubevs');
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly disposables: vscode.Disposable[];

  constructor() {
    this.disposables = [
      vscode.workspace.onDidOpenTextDocument((document) => this.schedule(document)),
      vscode.workspace.onDidChangeTextDocument((event) => this.schedule(event.document)),
      vscode.workspace.onDidCloseTextDocument((document) => {
        this.collection.delete(document.uri);
        const timer = this.timers.get(document.uri.toString());
        if (timer) clearTimeout(timer);
      }),
    ];
  }

  schedule(document: vscode.TextDocument): void {
    if (!this.isKubeJsDocument(document)) return;
    const key = document.uri.toString();
    const existing = this.timers.get(key);
    if (existing) clearTimeout(existing);
    const delay = vscode.workspace.getConfiguration('kubevs.validation').get('debounce', 300);
    this.timers.set(
      key,
      setTimeout(() => {
        this.validate(document);
        this.timers.delete(key);
      }, delay),
    );
  }

  validate(document: vscode.TextDocument): number {
    if (!vscode.workspace.getConfiguration('kubevs.validation').get('enabled', true)) {
      this.collection.delete(document.uri);
      return 0;
    }
    const diagnostics = analyzeKubeJs(
      document.getText(),
      classifyScriptPath(document.uri.path),
    ).map((issue) => {
      const line = Math.min(issue.line, Math.max(0, document.lineCount - 1));
      const lineLength = document.lineAt(line).text.length;
      const start = Math.min(issue.startCharacter, lineLength);
      const end = Math.min(Math.max(start + 1, issue.endCharacter), lineLength + 1);
      const diagnostic = new vscode.Diagnostic(
        new vscode.Range(line, start, line, end),
        issue.message,
        issue.severity === 'error'
          ? vscode.DiagnosticSeverity.Error
          : vscode.DiagnosticSeverity.Warning,
      );
      diagnostic.source = 'KubeVS';
      diagnostic.code = issue.code;
      return diagnostic;
    });
    this.collection.set(document.uri, diagnostics);
    return diagnostics.length;
  }

  validateOpenDocuments(): number {
    return vscode.workspace.textDocuments.reduce(
      (total, document) => total + (this.isKubeJsDocument(document) ? this.validate(document) : 0),
      0,
    );
  }

  private isKubeJsDocument(document: vscode.TextDocument): boolean {
    return (
      (document.languageId === 'javascript' || document.languageId === 'typescript') &&
      classifyScriptPath(document.uri.fsPath) !== undefined
    );
  }

  dispose(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.collection.dispose();
    this.disposables.forEach((disposable) => disposable.dispose());
  }
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const logs = new LogChannels();
  const project = new ProjectProvider();
  const diagnostics = new DiagnosticsController();
  const connectorClient = new ConnectorClient();
  const registryCatalog = new RegistryCatalog(connectorClient);
  registerRegistryCompletion(context, registryCatalog);
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(() => registryCatalog.clearProjectCache()),
    vscode.workspace.onDidCreateFiles(() => registryCatalog.clearProjectCache()),
    vscode.workspace.onDidDeleteFiles(() => registryCatalog.clearProjectCache()),
    vscode.workspace.onDidRenameFiles(() => registryCatalog.clearProjectCache()),
  );
  registerLanguageSupport(context);
  registerDataTools(context, connectorClient);
  registerRemoteWorkspace(context, connectorClient);
  let connectionState: ConnectionState = 'offline';
  let connectionError: string | undefined;
  let connectorHello: ConnectorHello | undefined;
  let liveStats: LiveStats | undefined;
  let connectionLatency: number | undefined;
  let connectionAttempt = 0;
  let recentScripts: string[] = context.workspaceState.get<string[]>('kubevs.recentScripts', []);
  const dashboardSnapshot = (): DashboardSnapshot => {
    const files = project.files;
    const byUri = new Map(files.map((uri) => [uri.toString(), uri]));
    const ordered = [
      ...new Set([
        ...recentScripts.filter((uri) => byUri.has(uri)),
        ...files.map((uri) => uri.toString()),
      ]),
    ].slice(0, 6);
    const problems = vscode.languages
      .getDiagnostics()
      .filter(([uri]) => classifyScriptPath(uri.path))
      .reduce((sum, [, issues]) => sum + issues.length, 0);
    return {
      state: connectionState,
      scripts: project.count,
      problems,
      workspace: vscode.workspace.name ?? 'No folder open',
      ...(connectionError ? { error: connectionError } : {}),
      ...(connectorHello?.session?.displayName
        ? { player: connectorHello.session.displayName }
        : {}),
      ...(connectorHello?.session?.role ? { role: connectorHello.session.role } : {}),
      ...(connectorHello ? { minecraft: connectorHello.minecraftVersion } : {}),
      kubejsMissing: connectionState === 'connected' && connectorHello?.kubejsVersion === null,
      canReload: connectorHello?.capabilities.reload === true,
      connectedHost: vscode.workspace.getConfiguration('kubevs.connector').get('host', '127.0.0.1'),
      canInspect: connectorHello?.session?.kind === 'player' && connectorHello.capabilities.inspect,
      canViewLocks: connectorHello?.capabilities.workspaceLocks === true,
      mcp: mcp?.status ?? { running: false },
      ...(liveStats ? { stats: liveStats } : {}),
      ...(connectionLatency === undefined ? {} : { latency: connectionLatency }),
      recent: ordered.map((uri) => ({
        uri,
        label: byUri.get(uri)?.path.split('/').at(-1) ?? uri,
        path: vscode.workspace.asRelativePath(byUri.get(uri) ?? vscode.Uri.parse(uri)),
      })),
    };
  };
  const dashboard = new DashboardController(context, dashboardSnapshot);
  const mcpWorkspace = new McpWorkspace(connectorClient, () => connectionState === 'connected');
  const mcp = new McpController(
    context,
    {
      connector: connectorClient,
      catalog: registryCatalog,
      workspace: mcpWorkspace,
      hello: () => (connectionState === 'connected' ? connectorHello : undefined),
      status: dashboardSnapshot,
      connect: async (code) => {
        await connectToMinecraft(
          false,
          false,
          code ? parseConnectorConnectionCode(code) : undefined,
          true,
          false,
          true,
        );
        if (connectionState !== 'connected')
          throw new Error(
            connectionError ?? 'No saved Connector credentials. Provide a private /kvs join code.',
          );
      },
      disconnect: () => disconnectFromMinecraft(false),
      refresh: async () => {
        registryCatalog.clearProjectCache();
        await project.refresh(connectionState === 'connected');
        dashboard.refresh();
      },
    },
    () => dashboard.refresh(),
    (message) => logs.main.info(message),
  );
  context.subscriptions.push(mcp);
  context.subscriptions.push(
    dashboard,
    project.onDidChangeTreeData(() => dashboard.refresh()),
    vscode.languages.onDidChangeDiagnostics(() => dashboard.refresh()),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (!editor || !classifyScriptPath(editor.document.uri.path)) return;
      recentScripts = [
        editor.document.uri.toString(),
        ...recentScripts.filter((uri) => uri !== editor.document.uri.toString()),
      ].slice(0, 12);
      void context.workspaceState.update('kubevs.recentScripts', recentScripts);
      dashboard.refresh();
    }),
  );

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 20);
  status.name = 'KubeVS Connector';
  status.command = 'kubevs.openDashboard';
  status.show();

  const updateConnectionUi = async (): Promise<void> => {
    const connected = connectionState === 'connected';
    status.text = connected
      ? `$(plug) ${t('Minecraft connected')}`
      : connectionState === 'error'
        ? `$(error) ${t('Connection failed')}`
        : connectionState === 'connecting'
          ? `$(sync~spin) ${t('Connecting…')}`
          : `$(debug-disconnect) ${t('KubeVS offline')}`;
    const sessionSuffix = connectorHello?.session
      ? t(' as {0}', connectorHello.session.displayName)
      : '';
    status.tooltip = connected
      ? t(
          'KubeVS Connector {0} is connected{1}.',
          connectorHello?.connectorVersion ?? '',
          sessionSuffix,
        )
      : (connectionError ?? t('KubeVS works offline. Select this status to open diagnostics.'));
    status.accessibilityInformation = {
      label: connected ? t('KubeVS Connector connected') : t('KubeVS works offline'),
    };
    await vscode.commands.executeCommand('setContext', 'kubevs.connected', connected);
    await vscode.commands.executeCommand(
      'setContext',
      'kubevs.lootjsAvailable',
      !connected || connectorHello?.capabilities.integrations.includes('lootjs') === true,
    );
    await vscode.commands.executeCommand(
      'setContext',
      'kubevs.kubejsAvailable',
      !connected || connectorHello?.kubejsVersion !== null,
    );
    dashboard.refresh();
  };
  context.subscriptions.push({
    dispose: connectorClient.onDisconnect((error) => {
      connectorHello = undefined;
      setRuntimeLocale();
      liveStats = undefined;
      connectionState = 'error';
      connectionError = t('Server ended the session: {0}', error.message);
      registryCatalog.clearLiveCache();
      logs.connector.warn(connectionError);
      void updateConnectionUi();
      void vscode.window
        .showWarningMessage(
          t(
            'KubeVS: the server ended the session. If the token or role changed, get a new code with /kvs join.',
          ),
          t('Connect with a new code'),
        )
        .then((choice) => {
          if (choice === t('Connect with a new code')) {
            void vscode.commands.executeCommand('kubevs.connectWithCode');
          }
        });
    }),
  });

  let projectRefreshTimer: NodeJS.Timeout | undefined;
  const scheduleProjectRefresh = (): void => {
    if (projectRefreshTimer) clearTimeout(projectRefreshTimer);
    projectRefreshTimer = setTimeout(() => {
      projectRefreshTimer = undefined;
      void project
        .refresh(connectionState === 'connected')
        .catch((error) => logs.main.warn(String(error)));
    }, 150);
  };
  context.subscriptions.push(
    vscode.workspace.onDidCreateFiles(scheduleProjectRefresh),
    vscode.workspace.onDidDeleteFiles(scheduleProjectRefresh),
    vscode.workspace.onDidRenameFiles(scheduleProjectRefresh),
    vscode.workspace.onDidSaveTextDocument(scheduleProjectRefresh),
    vscode.workspace.onDidChangeWorkspaceFolders(scheduleProjectRefresh),
    {
      dispose: () => {
        if (projectRefreshTimer) clearTimeout(projectRefreshTimer);
      },
    },
  );

  const register = (command: string, callback: (...args: unknown[]) => unknown): void => {
    context.subscriptions.push(vscode.commands.registerCommand(command, callback));
  };
  const ensureKubeJsAvailable = (): boolean => {
    if (connectionState !== 'connected' || connectorHello?.kubejsVersion !== null) return true;
    void vscode.window
      .showErrorMessage(
        t(
          'KubeVS: recipe creation requires KubeJS and its dependencies for Minecraft {0} (NeoForge). Install them in the connected game or server, restart it, then reconnect. Connector admin access does not replace KubeJS.',
          connectorHello.minecraftVersion,
        ),
        t('Get KubeJS'),
      )
      .then((choice) => {
        if (choice === t('Get KubeJS')) {
          void vscode.commands.executeCommand('kubevs.openKubeJsSetup');
        }
      });
    return false;
  };

  if (context.extensionMode === vscode.ExtensionMode.Test) {
    register('kubevs.__test.mcpWorkspace', async (value) => {
      const { operation, ...params } = value as { operation: string; [key: string]: unknown };
      const methods = ['roots', 'list', 'read', 'write', 'delete', 'mkdir', 'move'] as const;
      if (!methods.includes(operation as (typeof methods)[number]))
        throw new Error('Unknown workspace test operation');
      const call = mcpWorkspace[operation as (typeof methods)[number]].bind(mcpWorkspace) as (
        args: unknown,
      ) => Promise<unknown>;
      return call(params);
    });
    register('kubevs.__test.connectWithCode', async (value) => {
      if (typeof value !== 'string') throw new Error('Test connection code is required');
      await connectToMinecraft(false, false, parseConnectorConnectionCode(value), false, false);
    });
    register('kubevs.__test.dashboardHtml', () => dashboard.html);
    register('kubevs.__test.dashboardSnapshot', dashboardSnapshot);
    register('kubevs.__test.homeHtml', () => dashboard.homeHtml);
    register('kubevs.__test.homeVisible', () => dashboard.homeVisible);
    register('kubevs.__test.resolveConnectorCredentials', async () => {
      const configuration = vscode.workspace.getConfiguration('kubevs.connector');
      const host = configuration.get('host', '127.0.0.1');
      const port = configuration.get('port', 32145);
      const legacyProfile = configuration.get('profile', 'default');
      await forgetConnectorCredentials(context, { host, port, legacyProfile });
      return await resolveConnectorCredentials(context, {
        host,
        port,
        legacyProfile,
        interactive: false,
      });
    });
    register('kubevs.__test.saveVanillaRecipe', async (value) => {
      const target = await saveVanillaRecipeDraft(context, value);
      return target?.toString();
    });
    register('kubevs.__test.saveAddonRecipe', async (value) => {
      if (!isAddonRecipeDraft(value)) throw new Error('Invalid mod recipe draft');
      const target = await saveAddonRecipeDraft(context, value);
      return target?.toString();
    });
    register('kubevs.__test.loadCraftRecipes', async () => {
      const loaded = await loadRecipes(context, connectorClient);
      return { total: loaded.entries.length, source: loaded.source };
    });
  }

  context.subscriptions.push(
    logs,
    status,
    diagnostics,
    { dispose: () => connectorClient.disconnect() },
    vscode.window.registerWebviewViewProvider('kubevs.home', dashboard, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  register('kubevs.openDashboard', () => dashboard.show());
  register('kubevs.openSettings', () =>
    vscode.commands.executeCommand('workbench.action.openSettings', '@ext:kubevs.kubevs-extension'),
  );
  register('kubevs.openKubeJsSetup', () =>
    vscode.env.openExternal(
      vscode.Uri.parse('https://modrinth.com/mod/kubejs/versions?g=1.21.1&l=neoforge'),
    ),
  );
  register('kubevs.refreshProject', async () => {
    await project.refresh(connectionState === 'connected');
    logs.main.info(`Project index refreshed: ${project.count} scripts.`);
  });
  register('kubevs.validateProject', () => {
    const count = diagnostics.validateOpenDocuments();
    void vscode.window.showInformationMessage(
      count === 0
        ? 'KubeVS found no issues in open KubeJS files.'
        : `KubeVS found ${count} issue(s).`,
    );
  });
  const connectToMinecraft = async (
    allowPrompt: boolean,
    forceTokenSelection = false,
    direct?: {
      readonly host: string;
      readonly port: number;
      readonly token: string;
      readonly secure: boolean;
    },
    allowStoredRemote = false,
    mountRemoteWorkspace = true,
    headless = false,
  ): Promise<void> => {
    const attempt = ++connectionAttempt;
    const configuration = vscode.workspace.getConfiguration('kubevs.connector');
    const host = direct?.host ?? configuration.get('host', '127.0.0.1');
    const port = direct?.port ?? configuration.get('port', 32145);
    const profile = configuration.get('profile', 'default');
    const secure = direct?.secure ?? configuration.get('secure', false);
    if (!isLoopbackHost(host)) {
      if (!allowPrompt && !allowStoredRemote) {
        connectionState = 'error';
        connectionError = 'Automatic remote connections are disabled.';
        await updateConnectionUi();
        return;
      }
      const choice = headless
        ? t('Connect')
        : await vscode.window.showWarningMessage(
            secure
              ? t('Connect to secure server {0}:{1}?', host, port)
              : t(
                  'Connect to {0}:{1} without TLS? Use a VPN or enable publicSecure behind a TLS proxy.',
                  host,
                  port,
                ),
            { modal: true },
            t('Connect'),
          );
      if (attempt !== connectionAttempt) return;
      if (choice !== t('Connect')) {
        connectionState = 'offline';
        await updateConnectionUi();
        return;
      }
    }

    let credentials: ConnectorCredentials | undefined = direct
      ? {
          token: direct.token,
          secretKey: connectorCredentialKey(host, port),
          legacySecretKey: `kubevs.connector.token.${profile}`,
          source: 'pasted',
        }
      : undefined;
    try {
      credentials ??= await resolveConnectorCredentials(context, {
        host,
        port,
        legacyProfile: profile,
        interactive: allowPrompt,
        forceSelection: forceTokenSelection,
      });
    } catch (error) {
      if (attempt !== connectionAttempt) return;
      connectionState = 'error';
      connectionError = error instanceof Error ? error.message : String(error);
      logs.connector.error(`Could not load Connector credentials: ${connectionError}`);
      await updateConnectionUi();
      if (allowPrompt) void vscode.window.showErrorMessage(`KubeVS: ${connectionError}`);
      return;
    }
    if (attempt !== connectionAttempt) return;
    if (!credentials) {
      connectionState = 'offline';
      await updateConnectionUi();
      if (allowPrompt) void vscode.window.showInformationMessage(t('KubeVS connection cancelled.'));
      return;
    }

    connectionState = 'connecting';
    connectionError = undefined;
    connectionLatency = undefined;
    await updateConnectionUi();
    try {
      const hello = await connectorClient.connect(
        `${secure ? 'wss' : 'ws'}://${formatHost(host)}:${port}`,
        credentials.token,
      );
      if (attempt !== connectionAttempt) return;
      connectorHello = hello;
      setRuntimeLocale(connectorHello.session?.locale);
      await storeConnectorCredentials(context, credentials);
      if (attempt !== connectionAttempt) return;
      const [items, tags, recipes, mods] = await Promise.all([
        connectorClient.request<PagedIds>('registry.items', { limit: 1 }),
        connectorClient.request<PagedIds>('registry.tags', {
          registry: 'minecraft:item',
          limit: 1,
        }),
        connectorClient.request<PagedIds>('recipes.list', { limit: 1 }),
        connectorClient.request<ModSnapshot>('mods.list'),
      ]);
      if (attempt !== connectionAttempt) return;
      liveStats = {
        items: items.total,
        tags: tags.total,
        recipes: recipes.total,
        mods: mods.total,
      };
      connectionState = 'connected';
      registryCatalog.clearLiveCache();
      if (direct) {
        const settings = vscode.workspace.getConfiguration('kubevs.connector');
        await Promise.all([
          settings.update('host', direct.host, vscode.ConfigurationTarget.Global),
          settings.update('port', direct.port, vscode.ConfigurationTarget.Global),
          settings.update('secure', direct.secure, vscode.ConfigurationTarget.Global),
        ]);
        if (attempt !== connectionAttempt) return;
      }
      logs.connector.info(
        `Connected to Minecraft ${connectorHello.minecraftVersion}; ${items.total} items, ${recipes.total} recipes, ${mods.total} mods.`,
      );
      await updateConnectionUi();
      void project.refresh(true).catch((error) => {
        logs.main.warn(
          `Could not refresh the project index after connecting: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
      if (connectorHello.capabilities.workspaceFiles) {
        if (mountRemoteWorkspace) {
          await vscode.commands.executeCommand('kubevs.openServerWorkspace');
        } else {
          if (!headless)
            void vscode.window.showInformationMessage(t('KubeVS Connector connected.'));
        }
        return;
      }
      if (headless) return;
      try {
        const workspace = await bootstrapConnectorWorkspace(connectorHello, logs.connector);
        if (workspace.opened) return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logs.connector.warn(`Could not prepare Connector workspace: ${message}`);
        void vscode.window.showWarningMessage(
          t('KubeVS connected, but could not prepare the project folder: {0}', message),
        );
      }
      void vscode.window.showInformationMessage(t('KubeVS Connector connected.'));
    } catch (error) {
      if (attempt !== connectionAttempt) return;
      connectorClient.disconnect();
      connectorHello = undefined;
      setRuntimeLocale();
      liveStats = undefined;
      const authenticationFailed = isConnectorAuthenticationError(error);
      if (authenticationFailed) {
        await forgetConnectorCredentials(context, {
          host,
          port,
          legacyProfile: profile,
        });
        if (
          allowPrompt &&
          !forceTokenSelection &&
          (credentials.source === 'stored' || credentials.source === 'discovered')
        ) {
          logs.connector.warn('Saved or detected token was rejected; requesting a replacement.');
          await connectToMinecraft(true, true);
          return;
        }
      }
      connectionState = 'error';
      connectionError = describeConnectorConnectionError(error, host, port);
      logs.connector.error(`Connection failed: ${connectionError}`);
      await updateConnectionUi();
      if (allowPrompt) void vscode.window.showErrorMessage(`KubeVS: ${connectionError}`);
    }
  };

  register('kubevs.connect', () => connectToMinecraft(true));
  register('kubevs.connectWithCode', async (value) => {
    const raw =
      typeof value === 'string'
        ? value
        : await vscode.window.showInputBox({
            title: t('KubeVS — connect to server'),
            prompt: t('Run /kvs join in Minecraft and paste the copied code'),
            placeHolder: 'kubevs://server:32145?token=…',
            password: true,
            ignoreFocusOut: true,
          });
    if (!raw) return;
    try {
      const connection = parseConnectorConnectionCode(raw);
      await connectToMinecraft(true, false, connection);
    } catch (error) {
      connectionError = error instanceof Error ? error.message : String(error);
      dashboard.refresh();
      void vscode.window.showErrorMessage(
        `KubeVS: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
  register('kubevs.changeConnectorToken', () => connectToMinecraft(true, true));
  const disconnectFromMinecraft = async (removeFolder = true): Promise<void> => {
    connectionAttempt++;
    connectorClient.disconnect();
    registryCatalog.clearLiveCache();
    connectorHello = undefined;
    liveStats = undefined;
    connectionState = 'offline';
    connectionError = undefined;
    connectionLatency = undefined;
    logs.connector.info('Connector disconnected; Offline Mode remains available.');
    await updateConnectionUi();
    const remoteIndex =
      vscode.workspace.workspaceFolders?.findIndex(
        (folder) => folder.uri.scheme === 'kubevs-remote',
      ) ?? -1;
    if (removeFolder && remoteIndex >= 0) {
      vscode.workspace.updateWorkspaceFolders(remoteIndex, 1);
    }
  };
  register('kubevs.disconnect', () => disconnectFromMinecraft());
  register('kubevs.checkConnection', async () => {
    if (connectionState !== 'connected') {
      await vscode.commands.executeCommand('kubevs.connectWithCode');
      return;
    }
    const start = Date.now();
    try {
      if (connectorClient.capabilities?.status) {
        const health = await connectorClient.request<ConnectorStatus>('connector.status');
        if (!isConnectorStatus(health))
          throw new Error('Connector returned an invalid status snapshot.');
        logs.connector.info(
          `Server ready: ${health.players}/${health.maxPlayers} players; ${health.clients} editors; uptime ${health.uptimeSeconds}s.`,
        );
      } else {
        await connectorClient.request<PagedIds>('registry.items', { limit: 1 });
      }
      connectionLatency = Date.now() - start;
      dashboard.refresh();
      void vscode.window.showInformationMessage(`KubeVS connected · ${connectionLatency} ms`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logs.connector.warn(`Connection check failed: ${message}`);
      void vscode.window.showErrorMessage(`KubeVS: ${message}`);
    }
  });
  register('kubevs.showConnectionDiagnostics', () => {
    logs.connector.show(true);
    logs.connector.info(
      `State=${connectionState}; protocol=${PROTOCOL_VERSION}; host=${vscode.workspace.getConfiguration('kubevs.connector').get('host', '127.0.0.1')}`,
    );
  });
  register('kubevs.saveAndReload', async () => {
    const saved = await vscode.workspace.saveAll(false);
    if (!saved) {
      void vscode.window.showErrorMessage('KubeVS could not save all files. Reload was cancelled.');
      return;
    }
    const issueCount = diagnostics.validateOpenDocuments();
    if (issueCount > 0) {
      const choice = await vscode.window.showWarningMessage(
        `KubeVS found ${issueCount} issue(s). Reload anyway?`,
        { modal: true },
        'Reload',
      );
      if (choice !== 'Reload') return;
    }
    const activeKind = vscode.window.activeTextEditor
      ? classifyScriptPath(vscode.window.activeTextEditor.document.uri.fsPath)
      : undefined;
    if (activeKind === 'startup_scripts') {
      void vscode.window.showWarningMessage(
        'startup_scripts require a Minecraft restart and will not be applied by server reload.',
      );
    }
    if (connectionState !== 'connected') {
      void vscode.window.showWarningMessage(
        'Files were saved and validated. Reload requires KubeVS Connector.',
      );
      return;
    }
    if (!connectorClient.capabilities?.reload) {
      void vscode.window.showWarningMessage(
        'Reload is disabled. Enable permissions.allowReload in config/kubevs-connector.toml, restart Minecraft, and reconnect with an operator role.',
      );
      return;
    }
    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'KubeVS: reloading server scripts',
        },
        () => connectorClient.request<{ readonly reloaded: boolean }>('reload.server'),
      );
      const snapshot = await connectorClient.request<ConnectorLogSnapshot>('logs.list');
      for (const entry of snapshot.entries.slice(-50)) {
        logs.connector.info(
          `${entry.timestamp} [${entry.level}] [${entry.category}] ${entry.message}`,
        );
      }
      void vscode.window.showInformationMessage('KubeVS reload completed.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logs.connector.error(`Reload failed: ${message}`);
      void vscode.window.showErrorMessage(`KubeVS reload failed: ${message}`);
    }
  });

  register('kubevs.searchRegistry', () => registryCatalog.searchAndCopy());
  registerRecipeManagement(context, connectorClient);
  registerRecipeReplacement(context, connectorClient);
  register('kubevs.createRecipe', () => {
    if (ensureKubeJsAvailable()) openRecipeEditor(context, registryCatalog);
  });
  register('kubevs.createItem', () => {
    if (ensureKubeJsAvailable()) openContentBuilder(context, registryCatalog, 'item');
  });
  register('kubevs.createBlock', () => {
    if (ensureKubeJsAvailable()) openContentBuilder(context, registryCatalog, 'block');
  });
  register('kubevs.createAddonRecipe', () => {
    if (!ensureKubeJsAvailable()) return;
    openAddonRecipeEditor(
      context,
      registryCatalog,
      connectionState === 'connected'
        ? new Set(connectorHello?.capabilities.integrations ?? [])
        : undefined,
    );
  });
  register('kubevs.createLootRule', () => {
    if (!ensureKubeJsAvailable()) return;
    if (
      connectionState === 'connected' &&
      connectorHello?.capabilities.integrations.includes('lootjs') !== true
    ) {
      void vscode.window.showErrorMessage(
        t('KubeVS: LootJS is not installed on the connected server. Install LootJS and reconnect.'),
      );
      return;
    }
    openLootRuleEditor(context, registryCatalog);
  });
  register('kubevs.createGenericRecipe', async () => {
    if (!ensureKubeJsAvailable()) return;
    try {
      await openGenericRecipeEditor(context, registryCatalog);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(
        `KubeVS could not open the Generic Recipe Editor: ${message}`,
      );
    }
  });
  register('kubevs.createRecipeSchema', async () => {
    if (!ensureKubeJsAvailable()) return;
    try {
      await createRecipeSchema(context);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`KubeVS could not create the recipe schema: ${message}`);
    }
  });
  register('kubevs.openCraftGraph', () =>
    openCraftGraph(context, connectorClient, registryCatalog, false),
  );
  register('kubevs.calculateResources', () =>
    openCraftGraph(context, connectorClient, registryCatalog, true),
  );

  register('kubevs.openRegistryBrowser', () => openRegistryBrowser(context, registryCatalog));

  register('kubevs.importProject', async () => {
    if (!ensureKubeJsAvailable()) return;
    try {
      await importRecipeFile(context);
    } catch (error) {
      void vscode.window.showErrorMessage(
        `KubeVS: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
  register('kubevs.inspectHeldItem', async () => {
    try {
      const item = await connectorClient.request<{ id: string; count: number; name: string }>(
        'player.inspectHeldItem',
      );
      if (!/^[a-z0-9_.-]+:[a-z0-9_./-]+$/u.test(item.id) || !Number.isSafeInteger(item.count))
        throw new Error('Connector returned invalid item data.');
      await vscode.env.clipboard.writeText(item.id);
      void vscode.window.showInformationMessage(`${item.name} × ${item.count} · ID copied`);
    } catch (error) {
      void vscode.window.showErrorMessage(
        `KubeVS: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });

  await updateConnectionUi();
  vscode.workspace.textDocuments.forEach((document) => diagnostics.schedule(document));
  logs.main.info('KubeVS activation completed; network startup continues in the background.');

  const remoteWorkspaceOpen =
    vscode.workspace.workspaceFolders?.some((folder) => folder.uri.scheme === 'kubevs-remote') ===
    true;
  const connectorSettings = vscode.workspace.getConfiguration('kubevs.connector');
  const configuredHost = connectorSettings.get('host', '127.0.0.1');
  const configuredPort = connectorSettings.get('port', 32145);
  const storedEndpointToken = remoteWorkspaceOpen
    ? await context.secrets.get(connectorCredentialKey(configuredHost, configuredPort))
    : undefined;
  if (remoteWorkspaceOpen && storedEndpointToken) {
    void connectToMinecraft(false, false, undefined, true);
  } else if (connectorSettings.get('autoConnect', false)) {
    void connectToMinecraft(false);
  }
  void mcp
    .startIfEnabled()
    .catch((error) =>
      logs.main.error(
        `MCP startup failed: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return normalized === '127.0.0.1' || normalized === 'localhost' || normalized === '::1';
}

function formatHost(host: string): string {
  const trimmed = host.trim();
  return trimmed.includes(':') && !trimmed.startsWith('[') ? `[${trimmed}]` : trimmed;
}

function displayKind(kind: ScriptKind): string {
  if (kind === 'server_scripts') return t('Server scripts');
  if (kind === 'client_scripts') return t('Client scripts');
  return t('Startup scripts');
}

function scriptKindTooltip(kind: ScriptKind): string {
  if (kind === 'server_scripts') return t('Recipes, server events and LootJS.');
  if (kind === 'client_scripts') return t('Client events and user interfaces.');
  return t('Items, blocks and other startup registrations.');
}

export function deactivate(): void {}
