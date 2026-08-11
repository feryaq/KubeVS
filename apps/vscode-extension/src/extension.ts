import * as vscode from 'vscode';
import { openAddonRecipeEditor } from './addonRecipeEditor.js';
import { analyzeKubeJs, classifyScriptPath, type ScriptKind } from '@kubevs/kubejs-parser';
import {
  PROTOCOL_VERSION,
  type ConnectorHello,
  type ModSnapshot,
  type PagedIds,
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
import { fileCount, localeNumber, runtimeLanguage, setRuntimeLocale, t } from './localization.js';

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

class GroupItem extends vscode.TreeItem {
  constructor(
    label: string,
    readonly children: readonly vscode.TreeItem[],
    state = vscode.TreeItemCollapsibleState.Collapsed,
  ) {
    super(label, state);
    this.contextValue = 'kubevsGroup';
  }
}

class StaticProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;

  constructor(private readonly items: () => vscode.TreeItem[]) {}
  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }
  getChildren(element?: vscode.TreeItem): vscode.TreeItem[] {
    if (element instanceof GroupItem) return [...element.children];
    return element ? [] : this.items();
  }
  refresh(): void {
    this.changed.fire();
  }
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
    const diagnostics = analyzeKubeJs(document.getText()).map((issue) => {
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
  let liveMods: readonly ModSnapshot['entries'][number][] | undefined;

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 20);
  status.name = 'KubeVS Connector';
  status.command = 'kubevs.showConnectionDiagnostics';
  status.show();

  const connection = new StaticProvider(() => {
    const label =
      connectionState === 'connected'
        ? t('Minecraft connected')
        : connectionState === 'connecting'
          ? t('Connecting…')
          : connectionState === 'error'
            ? t('Connection failed')
            : t('Offline mode');
    const item = new vscode.TreeItem(label);
    item.iconPath = new vscode.ThemeIcon(
      connectionState === 'connected'
        ? 'pass-filled'
        : connectionState === 'connecting'
          ? 'sync~spin'
          : connectionState === 'error'
            ? 'error'
            : 'debug-disconnect',
    );
    item.description =
      connectionState === 'connected'
        ? `${connectorHello?.minecraftVersion ?? 'Minecraft'} · ${connectorHello?.session?.displayName ?? `Connector ${connectorHello?.connectorVersion ?? ''}`}`
        : (connectionError ?? t('Editors and project analysis are available locally'));
    item.tooltip =
      connectionState === 'connected'
        ? t('Live registries, recipes and reload are available through Connector.')
        : t('KubeVS remains fully usable without a running Minecraft instance.');
    const items = [item];

    if (connectionState !== 'connected' && connectionState !== 'connecting') {
      const connectCode = new vscode.TreeItem(t('Connect with code'));
      connectCode.description = t('copy it from /kvs join');
      connectCode.iconPath = new vscode.ThemeIcon('key');
      connectCode.command = {
        command: 'kubevs.connectWithCode',
        title: t('Connect with code'),
      };
      items.push(connectCode);
    }

    if (connectionState === 'connected') {
      if (connectorHello?.session) {
        const identity = new vscode.TreeItem(
          connectorHello.session.kind === 'admin'
            ? t('Administrator session')
            : t('Player: {0}', connectorHello.session.displayName),
        );
        identity.description = t(
          'role: {0}',
          connectorHello.session.role ??
            (connectorHello.session.kind === 'admin' ? 'admin' : 'viewer'),
        );
        identity.iconPath = new vscode.ThemeIcon(
          connectorHello.session.kind === 'admin' ? 'shield' : 'account',
        );
        items.push(identity);
      }
      if (connectorHello?.capabilities.workspaceFiles) {
        const serverFiles = new vscode.TreeItem(t('Server KubeJS workspace'));
        serverFiles.description = connectorHello.capabilities.workspaceWrite
          ? t('read and write')
          : t('read only');
        serverFiles.iconPath = new vscode.ThemeIcon('remote');
        serverFiles.command = {
          command: 'kubevs.openServerWorkspace',
          title: t('Open server KubeJS workspace'),
        };
        items.push(serverFiles);
        if (connectorHello.capabilities.workspaceLocks) {
          const locks = new vscode.TreeItem(t('Locked files'));
          locks.description = t('team members');
          locks.iconPath = new vscode.ThemeIcon('lock');
          locks.command = {
            command: 'kubevs.showServerFileLocks',
            title: t('Show locked server files'),
          };
          items.push(locks);
        }
      }
      const reload = new vscode.TreeItem(t('Save and reload'));
      reload.description = t('apply server_scripts');
      reload.iconPath = new vscode.ThemeIcon('refresh');
      reload.command = {
        command: 'kubevs.saveAndReload',
        title: t('Save and reload'),
      };
      items.push(reload);
    } else if (connectionState !== 'connecting') {
      const connect = new vscode.TreeItem(t('Connect Minecraft'));
      connect.description = t('localhost by default');
      connect.iconPath = new vscode.ThemeIcon('plug');
      connect.command = { command: 'kubevs.connect', title: t('Connect Minecraft') };
      items.push(connect);
    }
    return items;
  });
  const recipesProvider = new StaticProvider(() => {
    const recipeIntegrations = ['create', 'oritech', 'farmersdelight'] as const;
    const availableRecipeIntegrations = new Set(
      connectorHello?.capabilities.integrations.filter((id) =>
        recipeIntegrations.includes(id as (typeof recipeIntegrations)[number]),
      ) ?? [],
    );

    const addon = new vscode.TreeItem(t('Create mod recipe'));
    addon.description =
      connectionState === 'connected'
        ? t('{0}/3 integrations', availableRecipeIntegrations.size)
        : t('3 integrations · offline');
    addon.tooltip =
      connectionState === 'connected'
        ? recipeIntegrations
            .map((id) => {
              const mod = liveMods?.find((entry) => entry.id === id);
              return mod ? t('{0}: installed {1}', id, mod.version) : t('{0}: not installed', id);
            })
            .join('\n')
        : t('Offline mode allows editing without validating the target modpack.');
    addon.iconPath = new vscode.ThemeIcon('beaker');
    addon.command = { command: 'kubevs.createAddonRecipe', title: t('Create mod recipe') };

    const vanilla = new vscode.TreeItem(t('Create Vanilla recipe'));
    vanilla.description = t('6 recipe types');
    vanilla.iconPath = new vscode.ThemeIcon('beaker');
    vanilla.command = { command: 'kubevs.createRecipe', title: t('Create Vanilla recipe') };

    const generic = new vscode.TreeItem(t('Recipe from schema'));
    generic.description = 'JSON';
    generic.iconPath = new vscode.ThemeIcon('symbol-structure');
    generic.command = { command: 'kubevs.createGenericRecipe', title: t('Recipe from schema') };

    const itemBuilder = new vscode.TreeItem(t('Create item'));
    itemBuilder.description = t('automatic ID');
    itemBuilder.iconPath = new vscode.ThemeIcon('symbol-enum-member');
    itemBuilder.command = { command: 'kubevs.createItem', title: t('Create item') };

    const blockBuilder = new vscode.TreeItem(t('Create block'));
    blockBuilder.description = 'startup_scripts';
    blockBuilder.iconPath = new vscode.ThemeIcon('symbol-field');
    blockBuilder.command = { command: 'kubevs.createBlock', title: t('Create block') };

    const graph = new vscode.TreeItem(t('Craft Graph and resources'));
    graph.description = t('chains · alternatives');
    graph.iconPath = new vscode.ThemeIcon('type-hierarchy');
    graph.command = { command: 'kubevs.openCraftGraph', title: t('Craft Graph and resources') };

    const replace = new vscode.TreeItem(t('Replace recipe'));
    replace.description = t('directly by ID');
    replace.iconPath = new vscode.ThemeIcon('replace-all');
    replace.command = { command: 'kubevs.replaceRecipe', title: t('Replace recipe') };

    const remove = new vscode.TreeItem(t('Delete recipe'));
    remove.description = t('keeps source JSON unchanged');
    remove.iconPath = new vscode.ThemeIcon('trash');
    remove.command = { command: 'kubevs.deleteRecipe', title: t('Delete recipe') };

    const restore = new vscode.TreeItem(t('Restore recipe'));
    restore.description = t('remove deletion rule');
    restore.iconPath = new vscode.ThemeIcon('discard');
    restore.command = { command: 'kubevs.restoreRecipe', title: t('Restore recipe') };

    const createGroup = new GroupItem(
      t('Create content'),
      [itemBuilder, blockBuilder, addon, vanilla, generic],
      vscode.TreeItemCollapsibleState.Expanded,
    );
    createGroup.iconPath = new vscode.ThemeIcon('add');
    const toolsGroup = new GroupItem(t('Tools'), [graph]);
    toolsGroup.iconPath = new vscode.ThemeIcon('tools');
    const manageGroup = new GroupItem(t('Manage recipes'), [replace, remove, restore]);
    manageGroup.iconPath = new vscode.ThemeIcon('list-selection');

    const result: vscode.TreeItem[] = [createGroup, toolsGroup, manageGroup];
    if (liveStats) {
      const stats = new vscode.TreeItem(
        t('{0} recipes in Minecraft', localeNumber(liveStats.recipes)),
      );
      stats.description = t('live data');
      stats.iconPath = new vscode.ThemeIcon('server');
      result.push(stats);
    }
    return result;
  });
  const lootProvider = new StaticProvider(() => {
    const connected = connectionState === 'connected';
    const kubeJsAvailable = !connected || connectorHello?.kubejsVersion !== null;
    const lootJsAvailable =
      !connected || connectorHello?.capabilities.integrations.includes('lootjs') === true;
    const create = new vscode.TreeItem(t('New loot rule'));
    create.description = !kubeJsAvailable
      ? t('KubeJS required')
      : !lootJsAvailable
        ? t('LootJS is not installed')
        : t('conditions → loot');
    create.tooltip = !kubeJsAvailable
      ? t('KubeJS was not detected on the connected server.')
      : !lootJsAvailable
        ? t('Install LootJS on the server to create and apply loot rules.')
        : t('Choose a target, conditions and loot. Advanced AND / OR / NOT groups are available.');
    create.iconPath = new vscode.ThemeIcon(
      kubeJsAvailable && lootJsAvailable ? 'symbol-event' : 'lock',
    );
    if (kubeJsAvailable && lootJsAvailable) {
      create.command = { command: 'kubevs.createLootRule', title: t('New loot rule') };
    }
    return [create];
  });
  const registriesProvider = new StaticProvider(() => {
    const search = new vscode.TreeItem(t('Find game ID'));
    search.description = t('name or ID');
    search.tooltip = t('Items, blocks, fluids, entities, structures and biomes.');
    search.iconPath = new vscode.ThemeIcon('search');
    search.command = { command: 'kubevs.searchRegistry', title: t('Find game ID') };
    const result = [search];
    if (liveStats) {
      const items = new vscode.TreeItem(t('{0} items', localeNumber(liveStats.items)));
      items.description = t('{0} tags', localeNumber(liveStats.tags));
      items.iconPath = new vscode.ThemeIcon('database');
      const mods = new vscode.TreeItem(t('{0} mods loaded', localeNumber(liveStats.mods)));
      mods.description = t('current modpack');
      mods.iconPath = new vscode.ThemeIcon('server');
      result.push(items, mods);
    } else {
      const offline = new vscode.TreeItem(t('Offline project catalog'));
      offline.description = 'JS · JSON';
      offline.iconPath = new vscode.ThemeIcon('type-hierarchy');
      result.push(offline);
    }
    return result;
  });
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
    connection.refresh();
    lootProvider.refresh();
  };
  context.subscriptions.push({
    dispose: connectorClient.onDisconnect((error) => {
      connectorHello = undefined;
      setRuntimeLocale();
      liveStats = undefined;
      liveMods = undefined;
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

  const register = (command: string, callback: (...args: unknown[]) => unknown): void => {
    context.subscriptions.push(vscode.commands.registerCommand(command, callback));
  };
  const ensureKubeJsAvailable = (): boolean => {
    if (connectionState !== 'connected' || connectorHello?.kubejsVersion !== null) return true;
    void vscode.window.showErrorMessage(
      t(
        'KubeVS: KubeJS was not detected on the connected server. Server script creation and editing are disabled.',
      ),
    );
    return false;
  };

  if (context.extensionMode === vscode.ExtensionMode.Test) {
    register('kubevs.__test.connectWithCode', async (value) => {
      if (typeof value !== 'string') throw new Error('Test connection code is required');
      await connectToMinecraft(false, false, parseConnectorConnectionCode(value), false, false);
    });
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
    vscode.window.registerTreeDataProvider('kubevs.project', project),
    vscode.window.registerTreeDataProvider('kubevs.recipes', recipesProvider),
    vscode.window.registerTreeDataProvider('kubevs.lootjs', lootProvider),
    vscode.window.registerTreeDataProvider('kubevs.registries', registriesProvider),
    vscode.window.registerTreeDataProvider('kubevs.connection', connection),
  );

  register('kubevs.openDashboard', () => openDashboard(context, project.count, connectionState));
  register('kubevs.refreshProject', async () => {
    await project.refresh();
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
  ): Promise<void> => {
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
      const choice = await vscode.window.showWarningMessage(
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
      connectionState = 'error';
      connectionError = error instanceof Error ? error.message : String(error);
      logs.connector.error(`Could not load Connector credentials: ${connectionError}`);
      await updateConnectionUi();
      if (allowPrompt) void vscode.window.showErrorMessage(`KubeVS: ${connectionError}`);
      return;
    }
    if (!credentials) {
      connectionState = 'offline';
      await updateConnectionUi();
      if (allowPrompt) void vscode.window.showInformationMessage(t('KubeVS connection cancelled.'));
      return;
    }

    connectionState = 'connecting';
    connectionError = undefined;
    await updateConnectionUi();
    try {
      connectorHello = await connectorClient.connect(
        `${secure ? 'wss' : 'ws'}://${formatHost(host)}:${port}`,
        credentials.token,
      );
      setRuntimeLocale(connectorHello.session?.locale);
      await storeConnectorCredentials(context, credentials);
      const [items, tags, recipes, mods] = await Promise.all([
        connectorClient.request<PagedIds>('registry.items', { limit: 1 }),
        connectorClient.request<PagedIds>('registry.tags', {
          registry: 'minecraft:item',
          limit: 1,
        }),
        connectorClient.request<PagedIds>('recipes.list', { limit: 1 }),
        connectorClient.request<ModSnapshot>('mods.list'),
      ]);
      liveStats = {
        items: items.total,
        tags: tags.total,
        recipes: recipes.total,
        mods: mods.total,
      };
      liveMods = mods.entries;
      connectionState = 'connected';
      registryCatalog.clearLiveCache();
      logs.connector.info(
        `Connected to Minecraft ${connectorHello.minecraftVersion}; ${items.total} items, ${recipes.total} recipes, ${mods.total} mods.`,
      );
      recipesProvider.refresh();
      registriesProvider.refresh();
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
          void vscode.window.showInformationMessage(t('KubeVS Connector connected.'));
        }
        return;
      }
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
      connectorClient.disconnect();
      connectorHello = undefined;
      setRuntimeLocale();
      liveStats = undefined;
      liveMods = undefined;
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
      connectionError = error instanceof Error ? error.message : String(error);
      logs.connector.error(`Connection failed: ${connectionError}`);
      await updateConnectionUi();
      if (allowPrompt) void vscode.window.showErrorMessage(`KubeVS: ${connectionError}`);
    }
  };

  register('kubevs.connect', () => connectToMinecraft(true));
  register('kubevs.connectWithCode', async () => {
    const raw = await vscode.window.showInputBox({
      title: t('KubeVS — connect to server'),
      prompt: t('Run /kvs join in Minecraft and paste the copied code'),
      placeHolder: 'kubevs://server:32145?token=…',
      password: true,
      ignoreFocusOut: true,
    });
    if (!raw) return;
    try {
      const connection = parseConnectorConnectionCode(raw);
      const settings = vscode.workspace.getConfiguration('kubevs.connector');
      await Promise.all([
        settings.update('host', connection.host, vscode.ConfigurationTarget.Global),
        settings.update('port', connection.port, vscode.ConfigurationTarget.Global),
        settings.update('secure', connection.secure, vscode.ConfigurationTarget.Global),
      ]);
      await connectToMinecraft(true, false, connection);
    } catch (error) {
      void vscode.window.showErrorMessage(
        `KubeVS: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
  register('kubevs.changeConnectorToken', () => connectToMinecraft(true, true));
  register('kubevs.disconnect', async () => {
    connectorClient.disconnect();
    registryCatalog.clearLiveCache();
    connectorHello = undefined;
    liveStats = undefined;
    liveMods = undefined;
    connectionState = 'offline';
    connectionError = undefined;
    logs.connector.info('Connector disconnected; Offline Mode remains available.');
    recipesProvider.refresh();
    registriesProvider.refresh();
    await updateConnectionUi();
    const remoteIndex =
      vscode.workspace.workspaceFolders?.findIndex(
        (folder) => folder.uri.scheme === 'kubevs-remote',
      ) ?? -1;
    if (remoteIndex >= 0) {
      vscode.workspace.updateWorkspaceFolders(remoteIndex, 1);
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
        'Connector reload permission is disabled. Start the server with -Dkubevs.allowReload=true.',
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
    if (connectionState === 'connected' && connectorHello?.kubejsVersion === null) {
      void vscode.window.showErrorMessage(
        t(
          'KubeVS: KubeJS was not detected on the connected server. Server script creation is disabled.',
        ),
      );
      return;
    }
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

  for (const command of [
    'kubevs.openRegistryBrowser',
    'kubevs.importProject',
    'kubevs.inspectHeldItem',
  ]) {
    register(command, () =>
      vscode.window.showInformationMessage(
        t(
          'Feature {0} is still in development. See KubeVS documentation for its current status.',
          command.replace('kubevs.', ''),
        ),
      ),
    );
  }

  void project
    .refresh(false)
    .then(() => logs.main.info(`Project index ready: ${project.count} local scripts.`))
    .catch((error) => {
      logs.main.warn(
        `Could not build the local project index: ${error instanceof Error ? error.message : String(error)}`,
      );
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
}

function openDashboard(
  context: vscode.ExtensionContext,
  scriptCount: number,
  state: ConnectionState,
): void {
  const panel = vscode.window.createWebviewPanel(
    'kubevs.dashboard',
    t('KubeVS Dashboard'),
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true },
  );
  const nonce = createNonce();
  const logoUri = panel.webview.asWebviewUri(
    vscode.Uri.joinPath(context.extensionUri, 'media', 'kubevs-logo.png'),
  );
  panel.webview.html = dashboardHtml(panel.webview, nonce, scriptCount, state, logoUri);
  panel.webview.onDidReceiveMessage(
    (message: unknown) => {
      if (!isDashboardMessage(message)) return;
      const allowed = new Set([
        'kubevs.refreshProject',
        'kubevs.validateProject',
        'kubevs.connect',
      ]);
      if (allowed.has(message.command)) void vscode.commands.executeCommand(message.command);
    },
    undefined,
    context.subscriptions,
  );
}

function dashboardHtml(
  webview: vscode.Webview,
  nonce: string,
  scriptCount: number,
  state: ConnectionState,
  logoUri: vscode.Uri,
): string {
  const csp = [
    `default-src 'none'`,
    `style-src ${webview.cspSource} 'nonce-${nonce}'`,
    `script-src 'nonce-${nonce}'`,
    `img-src ${webview.cspSource} data:`,
  ].join('; ');
  const language = runtimeLanguage();
  const statusLabel =
    state === 'connected'
      ? t('Live')
      : state === 'connecting'
        ? t('Connecting…')
        : state === 'error'
          ? t('Connection failed')
          : t('Offline');
  const statusMessage =
    state === 'connected'
      ? t('Minecraft data and server files are available.')
      : t('Local editors and diagnostics remain available.');
  const connectAction =
    state === 'connected'
      ? ''
      : `<button class="secondary" data-command="kubevs.connect">${escapeHtml(t('Connect Minecraft'))}</button>`;
  return `<!doctype html>
<html lang="${language}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <title>${escapeHtml(t('KubeVS Dashboard'))}</title>
  <style nonce="${nonce}">
    :root { color-scheme: light dark; --brand: #8b5cf6; --brand-soft: color-mix(in srgb, var(--vscode-editor-background) 82%, var(--brand) 18%); }
    * { box-sizing: border-box; }
    body { margin: 0; color: var(--vscode-editor-foreground); background: var(--vscode-editor-background); font: var(--vscode-font-size)/1.5 var(--vscode-font-family); }
    main { width: min(920px, 100%); margin: 0 auto; padding: clamp(24px, 5vw, 64px); }
    .hero { display: grid; grid-template-columns: 76px minmax(0, 1fr); gap: 20px; align-items: center; padding-bottom: 28px; }
    .logo { width: 76px; height: 76px; border-radius: 18px; display: block; }
    h1 { margin: 0; font-size: clamp(28px, 5vw, 42px); line-height: 1.05; letter-spacing: -.025em; }
    .tagline { max-width: 68ch; margin: 8px 0 0; color: var(--vscode-descriptionForeground); }
    .status { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 12px; align-items: center; padding: 14px 16px; border-block: 1px solid var(--vscode-panel-border); background: var(--brand-soft); }
    .status-dot { width: 9px; height: 9px; border-radius: 50%; background: ${state === 'connected' ? 'var(--vscode-testing-iconPassed, #3fb950)' : state === 'error' ? 'var(--vscode-testing-iconFailed, #f85149)' : 'var(--vscode-descriptionForeground)'}; }
    .status strong { display: block; font-weight: 650; }
    .status span { color: var(--vscode-descriptionForeground); }
    .index { text-align: right; font-variant-numeric: tabular-nums; }
    .index b { display: block; font-size: 24px; line-height: 1; }
    .workspace { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 28px; align-items: end; padding-top: 32px; }
    h2 { margin: 0 0 8px; font-size: 17px; }
    p { margin: 0; }
    .actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
    button { min-height: 34px; padding: 6px 13px; border: 1px solid transparent; border-radius: 4px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); font: inherit; cursor: pointer; }
    button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
    button:focus-visible { outline: 2px solid var(--vscode-focusBorder); outline-offset: 2px; }
    @media (max-width: 640px) { .hero { grid-template-columns: 58px minmax(0, 1fr); } .logo { width: 58px; height: 58px; border-radius: 14px; } .status, .workspace { grid-template-columns: auto minmax(0, 1fr); } .index { grid-column: 2; text-align: left; } .workspace .actions { grid-column: 1 / -1; justify-content: flex-start; } }
    @media (forced-colors: active) { .status, button { border-color: CanvasText; } }
  </style>
</head>
<body>
  <main>
    <header class="hero">
      <img class="logo" src="${logoUri}" alt="KubeVS">
      <div><h1>KubeVS</h1><p class="tagline">${escapeHtml(t('KubeJS development with live Minecraft context, directly in VS Code.'))}</p></div>
    </header>
    <section class="status" aria-label="${escapeHtml(t('Workspace status'))}">
      <i class="status-dot" aria-hidden="true"></i>
      <div><strong>${escapeHtml(statusLabel)}</strong><span>${escapeHtml(statusMessage)}</span></div>
      <div class="index"><b>${localeNumber(scriptCount)}</b><span>${escapeHtml(t('KubeJS scripts'))}</span></div>
    </section>
    <section class="workspace">
      <div><h2>${escapeHtml(t('Start working'))}</h2><p class="tagline">${escapeHtml(t('Project index'))} · ${escapeHtml(t('Connection'))}</p></div>
      <div class="actions">
        <button data-command="kubevs.refreshProject">${escapeHtml(t('Refresh project'))}</button>
        <button class="secondary" data-command="kubevs.validateProject">${escapeHtml(t('Validate open files'))}</button>
        ${connectAction}
      </div>
    </section>
  </main>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.addEventListener('click', (event) => {
      const target = event.target instanceof HTMLElement ? event.target.closest('[data-command]') : null;
      if (target instanceof HTMLElement) vscode.postMessage({ type: 'command', command: target.dataset.command });
    });
  </script>
</body>
</html>`;
}
function isDashboardMessage(value: unknown): value is { type: 'command'; command: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    value.type === 'command' &&
    'command' in value &&
    typeof value.command === 'string'
  );
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
function createNonce(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from(
    { length: 32 },
    () => alphabet[Math.floor(Math.random() * alphabet.length)],
  ).join('');
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
