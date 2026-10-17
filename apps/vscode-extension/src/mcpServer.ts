import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import type { Socket } from 'node:net';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { KubeVsMcpResource, KubeVsMcpTool } from './mcpTypes.js';

const BODY_LIMIT = 1024 * 1024;
const MAX_ACTIVE_REQUESTS = 16;
const REQUEST_TIMEOUT_MS = 30_000;

export interface KubeVsMcpServerOptions {
  version: string;
  token: string;
  port?: number;
  tools: readonly KubeVsMcpTool[];
  resources?: readonly KubeVsMcpResource[];
  isTrusted: () => boolean;
  onError?: (message: string) => void;
}

function respond(
  res: ServerResponse,
  status: number,
  message: string,
  headers: Record<string, string> = {},
): void {
  if (res.headersSent || res.destroyed) return;
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(JSON.stringify({ error: message }));
}

function authorized(header: string | undefined, expected: Buffer): boolean {
  if (!header?.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(header.slice(7), 'utf8');
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += bytes.length;
    if (length > BODY_LIMIT) throw new RequestBodyError(413, 'Request body too large');
    chunks.push(bytes);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new RequestBodyError(400, 'Invalid JSON');
  }
}

class RequestBodyError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export class KubeVsMcpServer {
  private server: Server | undefined;
  private endpoint: string | undefined;
  private readonly sockets = new Set<Socket>();
  private readonly transports = new Set<StreamableHTTPServerTransport>();
  private activeRequests = 0;
  private starting: Promise<{ url: string; port: number }> | undefined;

  constructor(private readonly options: KubeVsMcpServerOptions) {
    if (!options.token) throw new Error('MCP token is required');
  }

  get running(): boolean {
    return this.server !== undefined && this.endpoint !== undefined;
  }
  get url(): string | undefined {
    return this.endpoint;
  }

  async start(): Promise<{ url: string; port: number }> {
    if (this.starting) return this.starting;
    const endpoint = this.endpoint;
    if (this.server && endpoint) return { url: endpoint, port: Number(new URL(endpoint).port) };
    this.starting = this.open();
    try {
      return await this.starting;
    } finally {
      this.starting = undefined;
    }
  }

  private async open(): Promise<{ url: string; port: number }> {
    const server = createServer((req, res) => {
      void this.handle(req, res).catch(() => {
        try {
          respond(res, 500, 'MCP request failed');
        } catch {
          res.destroy();
        }
      });
    });
    server.requestTimeout = REQUEST_TIMEOUT_MS;
    server.headersTimeout = 10_000;
    server.keepAliveTimeout = 5_000;
    server.on('connection', (socket) => {
      this.sockets.add(socket);
      socket.setTimeout(REQUEST_TIMEOUT_MS, () => socket.destroy());
      socket.on('close', () => this.sockets.delete(socket));
    });
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(this.options.port ?? 32146, '127.0.0.1', () => {
          server.off('error', reject);
          resolve();
        });
      });
      const address = server.address();
      if (!address || typeof address === 'string')
        throw new Error('MCP listener has no TCP address');
      this.server = server;
      this.endpoint = `http://127.0.0.1:${address.port}/mcp`;
      return { url: this.endpoint, port: address.port };
    } catch (error) {
      server.close();
      this.options.onError?.('MCP listener failed to start');
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.starting) await this.starting.catch(() => undefined);
    const server = this.server;
    this.server = undefined;
    this.endpoint = undefined;
    if (!server) return;
    for (const socket of this.sockets) socket.destroy();
    await Promise.allSettled([...this.transports].map((transport) => transport.close()));
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private makeMcpServer(): McpServer {
    const mcp = new McpServer(
      { name: 'KubeVS', version: this.options.version },
      {
        instructions:
          'KubeVS tools inspect and edit the trusted KubeJS project and connected Minecraft workspace.',
      },
    );
    for (const tool of this.options.tools) {
      mcp.registerTool(
        tool.name,
        {
          description: tool.description,
          inputSchema: tool.inputSchema,
          ...(tool.annotations ? { annotations: tool.annotations } : {}),
        },
        async (args) => {
          if (!this.options.isTrusted())
            return { content: [{ type: 'text', text: 'Workspace is not trusted' }], isError: true };
          try {
            const value = await tool.run(args as Record<string, unknown>);
            return {
              content: [{ type: 'text', text: JSON.stringify(value) ?? 'null' }],
              structuredContent: { result: value },
            };
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Tool failed';
            const safeMessage = message.replaceAll(this.options.token, '[redacted]');
            this.options.onError?.(`MCP tool ${tool.name} failed: ${safeMessage}`);
            return { content: [{ type: 'text', text: safeMessage }], isError: true };
          }
        },
      );
    }
    for (const resource of this.options.resources ?? []) {
      mcp.registerResource(
        resource.name,
        resource.uri,
        {
          description: resource.description,
          mimeType: 'application/json',
        },
        async (uri) => {
          if (!this.options.isTrusted()) throw new Error('Workspace is not trusted');
          try {
            const value = await resource.read();
            return {
              contents: [
                {
                  uri: uri.href,
                  mimeType: 'application/json',
                  text: JSON.stringify(value) ?? 'null',
                },
              ],
            };
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Resource failed';
            throw new Error(message.replaceAll(this.options.token, '[redacted]'));
          }
        },
      );
    }
    return mcp;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const endpoint = this.endpoint;
    if (!endpoint) {
      respond(res, 503, 'Service unavailable');
      return;
    }
    const port = new URL(endpoint).port;
    if (req.headers.host !== `127.0.0.1:${port}` && req.headers.host !== `localhost:${port}`) {
      respond(res, 403, 'Invalid Host');
      return;
    }
    if (req.headers.origin !== undefined) {
      respond(res, 403, 'Origin is not allowed');
      return;
    }
    if (!authorized(req.headers.authorization, Buffer.from(this.options.token, 'utf8'))) {
      respond(res, 401, 'Unauthorized', { 'www-authenticate': 'Bearer' });
      return;
    }
    if (!this.options.isTrusted()) {
      respond(res, 403, 'Workspace is not trusted');
      return;
    }
    if (req.url !== '/mcp') {
      respond(res, 404, 'Not found');
      return;
    }
    if (req.method !== 'POST') {
      respond(res, 405, 'Method not allowed', { allow: 'POST' });
      return;
    }
    if (!/^application\/json(?:\s*;|$)/iu.test(req.headers['content-type'] ?? '')) {
      respond(res, 415, 'Expected application/json');
      return;
    }
    if (this.activeRequests >= MAX_ACTIVE_REQUESTS) {
      respond(res, 503, 'Server busy');
      return;
    }
    this.activeRequests++;
    let mcp: McpServer | undefined;
    let transport: StreamableHTTPServerTransport | undefined;
    try {
      const body = await readJson(req);
      if (!this.options.isTrusted()) {
        respond(res, 403, 'Workspace is not trusted');
        return;
      }
      mcp = this.makeMcpServer();
      // Omitting sessionIdGenerator selects the SDK's stateless mode.
      transport = new StreamableHTTPServerTransport({
        enableJsonResponse: true,
      });
      this.transports.add(transport);
      await mcp.connect(transport as Parameters<McpServer['connect']>[0]);
      await transport.handleRequest(req, res, body);
    } catch (error) {
      if (error instanceof RequestBodyError) respond(res, error.status, error.message);
      else {
        this.options.onError?.('MCP request failed');
        respond(res, 500, 'MCP request failed');
      }
    } finally {
      if (mcp) await mcp.close().catch(() => undefined);
      if (transport) {
        await transport.close().catch(() => undefined);
        this.transports.delete(transport);
      }
      this.activeRequests--;
    }
  }
}
