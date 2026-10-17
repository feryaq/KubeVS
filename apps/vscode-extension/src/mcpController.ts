import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { KubeVsMcpServer } from './mcpServer.js';
import { createMcpResources, createMcpTools, type McpToolsContext } from './mcpTools.js';

const TOKEN_KEY = 'kubevs.mcp.bearerToken';

export class McpController implements vscode.Disposable {
  private server: KubeVsMcpServer | undefined;
  private starting: Promise<void> | undefined;
  private disposed = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly toolsContext: McpToolsContext,
    private readonly changed: () => void,
    private readonly log: (message: string) => void,
  ) {
    const register = (name: string, action: () => unknown): void => {
      context.subscriptions.push(vscode.commands.registerCommand(name, action));
    };
    register('kubevs.mcp.start', async () => {
      await this.start();
      await vscode.workspace
        .getConfiguration('kubevs.mcp')
        .update('enabled', true, vscode.ConfigurationTarget.Global);
      void vscode.window.showInformationMessage(`KubeVS MCP: ${this.server?.url}`);
    });
    register('kubevs.mcp.stop', async () => {
      await vscode.workspace
        .getConfiguration('kubevs.mcp')
        .update('enabled', false, vscode.ConfigurationTarget.Global);
      await this.stop();
    });
    register('kubevs.mcp.copyConfig', () => this.copyConfig());
    register('kubevs.mcp.rotateToken', async () => {
      await this.stop();
      await context.secrets.store(TOKEN_KEY, randomBytes(32).toString('hex'));
      await this.start();
      void vscode.window.showInformationMessage(
        'KubeVS MCP access key replaced. Copy the new connection configuration to your AI client.',
      );
    });
    register('kubevs.mcp.manage', async () => {
      const options = this.server?.running
        ? ['Copy MCP configuration', 'Stop MCP server', 'Replace access key']
        : ['Start MCP server', 'Copy MCP configuration'];
      const choice = await vscode.window.showQuickPick(options, {
        title: this.server?.url ? `KubeVS MCP · ${this.server.url}` : 'KubeVS MCP · stopped',
      });
      if (choice === 'Start MCP server') await vscode.commands.executeCommand('kubevs.mcp.start');
      if (choice === 'Copy MCP configuration') await this.copyConfig();
      if (choice === 'Stop MCP server') await vscode.commands.executeCommand('kubevs.mcp.stop');
      if (choice === 'Replace access key')
        await vscode.commands.executeCommand('kubevs.mcp.rotateToken');
    });
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (!event.affectsConfiguration('kubevs.mcp')) return;
        const enabled = vscode.workspace.getConfiguration('kubevs.mcp').get('enabled', false);
        if (!event.affectsConfiguration('kubevs.mcp.port') && enabled === this.status.running)
          return;
        void this.reconfigure().catch((error) => this.report(error));
      }),
      vscode.workspace.onDidGrantWorkspaceTrust(() => {
        void this.startIfEnabled().catch((error) => this.report(error));
      }),
    );
    if (context.extensionMode === vscode.ExtensionMode.Test) {
      register('kubevs.__test.mcpStart', async () => {
        await this.start(0);
        return { url: this.server?.url, token: await this.token() };
      });
      register('kubevs.__test.mcpStop', () => this.stop());
    }
  }

  get status(): { running: boolean; url?: string } {
    return {
      running: this.server?.running ?? false,
      ...(this.server?.url ? { url: this.server.url } : {}),
    };
  }

  async startIfEnabled(): Promise<void> {
    if (
      vscode.workspace.getConfiguration('kubevs.mcp').get('enabled', false) &&
      vscode.workspace.isTrusted
    )
      await this.start();
  }

  async start(portOverride?: number): Promise<void> {
    if (this.disposed) throw new Error('KubeVS MCP has been disposed.');
    if (!vscode.workspace.isTrusted)
      throw new Error('Trust this VS Code workspace before starting KubeVS MCP.');
    if (this.starting) return this.starting;
    if (this.server?.running) return;
    this.starting = (async () => {
      const server = new KubeVsMcpServer({
        version: this.context.extension.packageJSON.version as string,
        token: await this.token(),
        port:
          portOverride ??
          vscode.workspace.getConfiguration('kubevs.mcp').get<number>('port', 32146),
        tools: createMcpTools(this.toolsContext),
        resources: createMcpResources(this.toolsContext),
        isTrusted: () => !this.disposed && vscode.workspace.isTrusted,
        onError: (message) => this.log(message),
      });
      try {
        await server.start();
        if (this.disposed) {
          await server.stop();
          return;
        }
        this.server = server;
        this.log(`KubeVS MCP listening at ${server.url}`);
        this.changed();
      } catch (error) {
        await server.stop();
        throw error;
      }
    })().finally(() => {
      this.starting = undefined;
    });
    return this.starting;
  }

  async stop(): Promise<void> {
    await this.starting?.catch(() => undefined);
    const server = this.server;
    this.server = undefined;
    await server?.stop();
    this.changed();
  }

  private async reconfigure(): Promise<void> {
    await this.stop();
    await this.startIfEnabled();
  }

  private async token(): Promise<string> {
    const existing = await this.context.secrets.get(TOKEN_KEY);
    if (existing) return existing;
    const token = randomBytes(32).toString('hex');
    await this.context.secrets.store(TOKEN_KEY, token);
    return token;
  }

  private async copyConfig(): Promise<void> {
    await this.start();
    const config = {
      mcpServers: {
        kubevs: {
          type: 'http',
          url: this.server?.url,
          headers: { Authorization: `Bearer ${await this.token()}` },
        },
      },
    };
    await vscode.env.clipboard.writeText(JSON.stringify(config, null, 2));
    void vscode.window.showInformationMessage(
      'MCP configuration copied with its access key. Paste it into your AI client.',
    );
  }

  private report(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.log(`MCP could not start: ${message}`);
    void vscode.window.showErrorMessage(
      `KubeVS MCP: ${message}. If the port is busy, choose another kubevs.mcp.port or set it to 0.`,
    );
  }

  dispose(): void {
    this.disposed = true;
    void this.stop();
  }
}
