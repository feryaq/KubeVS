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
import { isConnectorAuthenticationError } from './connectorAuthCore.js';
import { ConnectorClient } from './connectorClient.js';
import { openContentBuilder } from './contentBuilder.js';
import { openCraftGraph } from './craftGraph.js';
import { registerDataTools } from './dataTools.js';
import { createRecipeSchema, openGenericRecipeEditor } from './genericRecipeEditor.js';
import { registerLanguageSupport } from './languageSupport.js';
import { openLootRuleEditor } from './lootRuleEditor.js';
import { openRecipeEditor } from './recipeEditor.js';
import { registerRecipeManagement } from './recipeManagement.js';
import { registerRecipeReplacement } from './recipeReplacement.js';
import { registerRemoteWorkspace } from './remoteWorkspace.js';
import { RegistryCatalog } from './registryCatalog.js';
import { registerRegistryCompletion } from './registryCompletion.js';
import { bootstrapConnectorWorkspace } from './workspaceBootstrap.js';

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

  constructor(private readonly extensionUri: vscode.Uri) {}

  async refresh(): Promise<void> {
    const files = await vscode.workspace.findFiles(
      '**/{server_scripts,client_scripts,startup_scripts}/**/*.{js,ts}',
      '**/{node_modules,.git,build}/**',
      5000,
    );
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
          item.description = `${files.length} ${plural(files.length, 'файл', 'файла', 'файлов')}`;
          item.tooltip = scriptKindTooltip(kind);
          item.iconPath = {
            light: vscode.Uri.joinPath(this.extensionUri, 'media', 'pixel', 'light', 'project.png'),
            dark: vscode.Uri.joinPath(this.extensionUri, 'media', 'pixel', 'dark', 'project.png'),
          };
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

class StaticProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;

  constructor(private readonly items: () => vscode.TreeItem[]) {}
  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }
  getChildren(): vscode.TreeItem[] {
    return this.items();
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
  const project = new ProjectProvider(context.extensionUri);
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
  const pixelIcon = (name: string): { light: vscode.Uri; dark: vscode.Uri } => ({
    light: vscode.Uri.joinPath(context.extensionUri, 'media', 'pixel', 'light', `${name}.png`),
    dark: vscode.Uri.joinPath(context.extensionUri, 'media', 'pixel', 'dark', `${name}.png`),
  });

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 20);
  status.name = 'KubeVS Connector';
  status.command = 'kubevs.showConnectionDiagnostics';
  status.show();

  const connection = new StaticProvider(() => {
    const label =
      connectionState === 'connected'
        ? 'Minecraft подключён'
        : connectionState === 'connecting'
          ? 'Подключение…'
          : connectionState === 'error'
            ? 'Ошибка подключения'
            : 'Офлайн-режим';
    const item = new vscode.TreeItem(label);
    item.iconPath = new vscode.ThemeIcon(
      connectionState === 'connected'
        ? 'pass-filled'
        : connectionState === 'error'
          ? 'error'
          : 'debug-disconnect',
    );
    item.description =
      connectionState === 'connected'
        ? `${connectorHello?.minecraftVersion ?? 'Minecraft'} · ${connectorHello?.session?.displayName ?? `Connector ${connectorHello?.connectorVersion ?? ''}`}`
        : (connectionError ?? 'Редакторы и анализ проекта доступны локально');
    item.tooltip =
      connectionState === 'connected'
        ? 'Живые реестры, рецепты и перезагрузка доступны через Connector.'
        : 'KubeVS продолжает работать без запущенного Minecraft.';
    const items = [item];
    if (connectionState === 'connected') {
      if (connectorHello?.session) {
        const identity = new vscode.TreeItem(
          connectorHello.session.kind === 'admin'
            ? 'Сессия администратора'
            : `Игрок: ${connectorHello.session.displayName}`,
        );
        identity.description =
          connectorHello.session.kind === 'admin'
            ? 'полный токен сервера'
            : `личный токен · уровень ${connectorHello.session.permissionLevel ?? '?'}`;
        identity.iconPath = new vscode.ThemeIcon(
          connectorHello.session.kind === 'admin' ? 'shield' : 'account',
        );
        items.push(identity);
      }
      if (connectorHello?.capabilities.workspaceFiles) {
        const serverFiles = new vscode.TreeItem('Открыть серверный файл');
        serverFiles.description = 'блокировка от конфликтов';
        serverFiles.iconPath = new vscode.ThemeIcon('remote');
        serverFiles.command = {
          command: 'kubevs.openServerWorkspace',
          title: 'Открыть серверный файл',
        };
        items.push(serverFiles);
        if (connectorHello.capabilities.workspaceLocks) {
          const locks = new vscode.TreeItem('Занятые файлы');
          locks.description = 'участники команды';
          locks.iconPath = new vscode.ThemeIcon('lock');
          locks.command = {
            command: 'kubevs.showServerFileLocks',
            title: 'Показать занятые серверные файлы',
          };
          items.push(locks);
        }
      }
      const reload = new vscode.TreeItem('Сохранить и перезагрузить');
      reload.description = 'применить server_scripts';
      reload.iconPath = pixelIcon('refresh');
      reload.command = {
        command: 'kubevs.saveAndReload',
        title: 'Сохранить и перезагрузить',
      };
      items.push(reload);
    } else {
      const connect = new vscode.TreeItem('Подключить Minecraft');
      connect.description = 'localhost по умолчанию';
      connect.iconPath = pixelIcon('connection');
      connect.command = { command: 'kubevs.connect', title: 'Подключить Minecraft' };
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
    const addon = new vscode.TreeItem('Новый рецепт мода');
    addon.description =
      connectionState === 'connected'
        ? `${availableRecipeIntegrations.size}/3 интеграций`
        : '3 интеграции · офлайн';
    addon.tooltip =
      connectionState === 'connected'
        ? recipeIntegrations
            .map((id) => {
              const mod = liveMods?.find((entry) => entry.id === id);
              return `${id}: ${mod ? `установлен ${mod.version}` : 'не установлен'}`;
            })
            .join('\n')
        : 'В Offline Mode редакторы доступны без проверки состава будущей сборки.';
    addon.iconPath = pixelIcon('recipes');
    addon.command = {
      command: 'kubevs.createAddonRecipe',
      title: 'Создать рецепт мода',
    };
    const vanilla = new vscode.TreeItem('Новый Vanilla-рецепт');
    vanilla.description = '6 типов';
    vanilla.iconPath = new vscode.ThemeIcon('beaker');
    vanilla.command = { command: 'kubevs.createRecipe', title: 'Создать Vanilla-рецепт' };
    const generic = new vscode.TreeItem('Рецепт по схеме');
    generic.description = 'JSON';
    generic.iconPath = new vscode.ThemeIcon('symbol-structure');
    generic.command = {
      command: 'kubevs.createGenericRecipe',
      title: 'Создать рецепт по схеме',
    };
    const graph = new vscode.TreeItem('Дерево рецептов и ресурсы');
    graph.description = 'цепочки · альтернативы';
    graph.iconPath = pixelIcon('project');
    graph.command = { command: 'kubevs.openCraftGraph', title: 'Открыть дерево рецептов' };
    const remove = new vscode.TreeItem('Удалить рецепт');
    remove.description = 'без изменения исходного JSON';
    remove.iconPath = new vscode.ThemeIcon('trash');
    remove.command = { command: 'kubevs.deleteRecipe', title: 'Удалить рецепт' };
    const replace = new vscode.TreeItem('Заменить рецепт');
    replace.description = 'сразу по ID';
    replace.iconPath = new vscode.ThemeIcon('replace-all');
    replace.command = { command: 'kubevs.replaceRecipe', title: 'Заменить рецепт другим' };
    const restore = new vscode.TreeItem('Восстановить рецепт');
    restore.description = 'убрать правило удаления';
    restore.iconPath = new vscode.ThemeIcon('discard');
    restore.command = { command: 'kubevs.restoreRecipe', title: 'Восстановить рецепт' };
    const itemBuilder = new vscode.TreeItem('Создать предмет');
    itemBuilder.description = 'ID автоматически';
    itemBuilder.iconPath = new vscode.ThemeIcon('symbol-enum-member');
    itemBuilder.command = { command: 'kubevs.createItem', title: 'Создать предмет' };
    const blockBuilder = new vscode.TreeItem('Создать блок');
    blockBuilder.description = 'startup_scripts';
    blockBuilder.iconPath = new vscode.ThemeIcon('symbol-field');
    blockBuilder.command = { command: 'kubevs.createBlock', title: 'Создать блок' };
    const result = [
      itemBuilder,
      blockBuilder,
      addon,
      vanilla,
      generic,
      graph,
      replace,
      remove,
      restore,
    ];
    if (liveStats) {
      const stats = new vscode.TreeItem(
        `${liveStats.recipes.toLocaleString('ru-RU')} рецептов в Minecraft`,
      );
      stats.description = 'живые данные';
      stats.iconPath = pixelIcon('server');
      result.push(stats);
    }
    return result;
  });
  const lootProvider = new StaticProvider(() => {
    const connected = connectionState === 'connected';
    const kubeJsAvailable = !connected || connectorHello?.kubejsVersion !== null;
    const lootJsAvailable =
      !connected || connectorHello?.capabilities.integrations.includes('lootjs') === true;
    const create = new vscode.TreeItem('Новое правило добычи');
    create.description = !kubeJsAvailable
      ? 'нужен KubeJS'
      : !lootJsAvailable
        ? 'LootJS не установлен'
        : 'условия → добыча';
    create.tooltip = !kubeJsAvailable
      ? 'На подключённом сервере не обнаружен KubeJS.'
      : !lootJsAvailable
        ? 'Установите LootJS на сервер, чтобы создавать и применять правила добычи.'
        : 'Выберите цель, условия и результат. Сложные AND / OR / NOT доступны дополнительно.';
    create.iconPath = pixelIcon('loot');
    if (kubeJsAvailable && lootJsAvailable) {
      create.command = {
        command: 'kubevs.createLootRule',
        title: 'Создать правило LootJS',
      };
    }
    if (!kubeJsAvailable || !lootJsAvailable) {
      create.iconPath = new vscode.ThemeIcon('lock');
    }
    return [create];
  });
  const registriesProvider = new StaticProvider(() => {
    const search = new vscode.TreeItem('Найти игровой ID');
    search.description = 'имя или ID';
    search.tooltip = 'Предметы, блоки, жидкости, сущности, структуры и биомы.';
    search.iconPath = pixelIcon('search');
    search.command = { command: 'kubevs.searchRegistry', title: 'Найти игровой ID' };
    const result = [search];
    if (liveStats) {
      const items = new vscode.TreeItem(`${liveStats.items.toLocaleString('ru-RU')} предметов`);
      items.description = `${liveStats.tags.toLocaleString('ru-RU')} тегов`;
      items.iconPath = pixelIcon('registries');
      const mods = new vscode.TreeItem(`${liveStats.mods.toLocaleString('ru-RU')} модов загружено`);
      mods.description = 'текущая сборка';
      mods.iconPath = pixelIcon('server');
      result.push(items, mods);
    } else {
      const offline = new vscode.TreeItem('Офлайн-каталог проекта');
      offline.description = 'JS · JSON';
      offline.iconPath = pixelIcon('project');
      result.push(offline);
    }
    return result;
  });

  const updateConnectionUi = async (): Promise<void> => {
    const connected = connectionState === 'connected';
    status.text = connected
      ? '$(plug) Minecraft подключён'
      : connectionState === 'error'
        ? '$(error) Ошибка KubeVS'
        : connectionState === 'connecting'
          ? '$(sync~spin) Подключение'
          : '$(debug-disconnect) KubeVS офлайн';
    status.tooltip = connected
      ? `KubeVS Connector ${connectorHello?.connectorVersion ?? ''} подключён${connectorHello?.session ? ` как ${connectorHello.session.displayName}` : ''}.`
      : (connectionError ?? 'KubeVS работает офлайн. Нажмите, чтобы открыть диагностику.');
    status.accessibilityInformation = {
      label: connected ? 'KubeVS Connector подключён' : 'KubeVS работает офлайн',
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

  const register = (command: string, callback: (...args: unknown[]) => unknown): void => {
    context.subscriptions.push(vscode.commands.registerCommand(command, callback));
  };
  const ensureKubeJsAvailable = (): boolean => {
    if (connectionState !== 'connected' || connectorHello?.kubejsVersion !== null) return true;
    void vscode.window.showErrorMessage(
      'KubeVS: на подключённом сервере не обнаружен KubeJS. Создание и изменение серверных скриптов отключено.',
    );
    return false;
  };

  if (context.extensionMode === vscode.ExtensionMode.Test) {
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
  ): Promise<void> => {
    connectionState = 'connecting';
    connectionError = undefined;
    await updateConnectionUi();
    const configuration = vscode.workspace.getConfiguration('kubevs.connector');
    const host = configuration.get('host', '127.0.0.1');
    const port = configuration.get('port', 32145);
    const profile = configuration.get('profile', 'default');
    if (!isLoopbackHost(host)) {
      if (!allowPrompt) {
        connectionState = 'error';
        connectionError = 'Automatic remote connections are disabled.';
        await updateConnectionUi();
        return;
      }
      const choice = await vscode.window.showWarningMessage(
        `Connect to non-loopback host ${host}? Tokens are sent in the WebSocket handshake.`,
        { modal: true },
        'Connect',
      );
      if (choice !== 'Connect') {
        connectionState = 'offline';
        await updateConnectionUi();
        return;
      }
    }

    let credentials: ConnectorCredentials | undefined;
    try {
      credentials = await resolveConnectorCredentials(context, {
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
      if (allowPrompt) void vscode.window.showInformationMessage('KubeVS connection cancelled.');
      return;
    }

    try {
      connectorHello = await connectorClient.connect(
        `ws://${formatHost(host)}:${port}`,
        credentials.token,
      );
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
      try {
        const workspace = await bootstrapConnectorWorkspace(connectorHello, logs.connector);
        if (workspace.opened) return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logs.connector.warn(`Could not prepare Connector workspace: ${message}`);
        void vscode.window.showWarningMessage(
          `KubeVS подключён, но не смог подготовить папку проекта: ${message}`,
        );
      }
      void vscode.window.showInformationMessage('KubeVS Connector connected.');
    } catch (error) {
      connectorClient.disconnect();
      connectorHello = undefined;
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
        'KubeVS: на подключённом сервере не обнаружен KubeJS. Создание серверных скриптов отключено.',
      );
      return;
    }
    if (
      connectionState === 'connected' &&
      connectorHello?.capabilities.integrations.includes('lootjs') !== true
    ) {
      void vscode.window.showErrorMessage(
        'KubeVS: LootJS не установлен на подключённом сервере. Установите LootJS и переподключитесь.',
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
        `Функция ${command.replace('kubevs.', '')} ещё находится в разработке. Текущий статус указан в документации KubeVS.`,
      ),
    );
  }

  await project.refresh();
  await updateConnectionUi();
  vscode.workspace.textDocuments.forEach((document) => diagnostics.schedule(document));
  logs.main.info(`KubeVS activated in Offline Mode with ${project.count} indexed scripts.`);

  if (vscode.workspace.getConfiguration('kubevs.connector').get('autoConnect', false)) {
    await connectToMinecraft(false);
  }
}

function openDashboard(
  context: vscode.ExtensionContext,
  scriptCount: number,
  state: ConnectionState,
): void {
  const panel = vscode.window.createWebviewPanel(
    'kubevs.dashboard',
    'KubeVS Dashboard',
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true },
  );
  const nonce = createNonce();
  panel.webview.html = dashboardHtml(panel.webview, nonce, scriptCount, state);
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
): string {
  const csp = [
    `default-src 'none'`,
    `style-src ${webview.cspSource} 'nonce-${nonce}'`,
    `script-src 'nonce-${nonce}'`,
    `img-src ${webview.cspSource} data:`,
  ].join('; ');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <title>KubeVS Dashboard</title>
  <style nonce="${nonce}">
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; }
    body { margin: 0; color: var(--vscode-editor-foreground); background: var(--vscode-editor-background); font: var(--vscode-font-size)/1.45 var(--vscode-font-family); }
    main { max-width: 1040px; margin: 0 auto; padding: clamp(20px, 5vw, 64px); }
    header { display: flex; gap: 18px; align-items: center; margin-bottom: 32px; }
    .mark { width: 52px; height: 52px; display: grid; place-items: center; border-radius: 12px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); font-size: 26px; }
    h1 { margin: 0; font-size: clamp(24px, 5vw, 38px); letter-spacing: -.02em; }
    .tagline { margin: 4px 0 0; color: var(--vscode-descriptionForeground); }
    .grid { display: grid; grid-template-columns: repeat(auto-fit,minmax(230px,1fr)); gap: 12px; }
    article { min-height: 150px; padding: 18px; border: 1px solid var(--vscode-panel-border); border-radius: 8px; background: var(--vscode-sideBar-background); }
    h2 { margin: 0 0 8px; font-size: 15px; }
    .metric { margin: 16px 0 4px; font-size: 30px; font-weight: 600; }
    .muted { color: var(--vscode-descriptionForeground); }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 24px; }
    button { min-height: 32px; padding: 5px 12px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); border: 1px solid transparent; border-radius: 2px; font: inherit; cursor: pointer; }
    button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
    @media (max-width: 480px) { header { align-items: flex-start; } .mark { width: 42px; height: 42px; } }
    @media (forced-colors: active) { article, button { border-color: CanvasText; } }
  </style>
</head>
<body>
  <main>
    <header><div class="mark" aria-hidden="true">◇</div><div><h1>KubeVS</h1><p class="tagline">KubeJS development, visually integrated into VS Code.</p></div></header>
    <section class="grid" aria-label="Workspace overview">
      <article><h2>Project</h2><div class="metric">${scriptCount}</div><div class="muted">KubeJS scripts indexed</div></article>
      <article><h2>Connection</h2><div class="metric">${state === 'connected' ? 'Live' : state === 'connecting' ? 'Connecting' : 'Offline'}</div><div class="muted">${state === 'connected' ? 'Minecraft data is available through KubeVS Connector' : 'Editing and static diagnostics remain available'}</div></article>
      <article><h2>Foundation</h2><div class="metric">Ready</div><div class="muted">Project index, Problems, views, commands and theme-aware UI</div></article>
    </section>
    <div class="actions">
      <button data-command="kubevs.refreshProject">Refresh project</button>
      <button class="secondary" data-command="kubevs.validateProject">Validate</button>
      ${state === 'connected' ? '' : '<button class="secondary" data-command="kubevs.connect">Connect Minecraft</button>'}
    </div>
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
  if (kind === 'server_scripts') return 'Серверные скрипты';
  if (kind === 'client_scripts') return 'Клиентские скрипты';
  return 'Скрипты запуска';
}

function scriptKindTooltip(kind: ScriptKind): string {
  if (kind === 'server_scripts') return 'Рецепты, события сервера и LootJS.';
  if (kind === 'client_scripts') return 'Клиентские события и интерфейс.';
  return 'Регистрация предметов, блоков и других объектов при запуске.';
}

function plural(value: number, one: string, few: string, many: string): string {
  const mod100 = value % 100;
  const mod10 = value % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

export function deactivate(): void {}
