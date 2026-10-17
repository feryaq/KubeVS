import type { ZodRawShape } from 'zod';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';

export interface KubeVsMcpTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: ZodRawShape;
  readonly annotations?: ToolAnnotations;
  readonly run: (args: Record<string, unknown>) => Promise<unknown>;
}

export interface KubeVsMcpResource {
  readonly uri: string;
  readonly name: string;
  readonly description: string;
  readonly read: () => Promise<unknown>;
}
