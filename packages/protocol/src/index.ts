export const PROTOCOL_VERSION = 1 as const;

export type ConnectorPermission =
  | 'kubevs.connect'
  | 'kubevs.registry.read'
  | 'kubevs.recipes.read'
  | 'kubevs.logs.read'
  | 'kubevs.reload'
  | 'kubevs.inspect';

export interface ConnectorCapabilities {
  readonly registries: boolean;
  readonly recipes: boolean;
  readonly logs: boolean;
  readonly reload: boolean;
  readonly inspect: boolean;
  readonly integrations: readonly string[];
  readonly workspaceFiles?: boolean;
  readonly workspaceLocks?: boolean;
  readonly workspaceMaxFileBytes?: number;
}

export interface ConnectorHello {
  readonly type: 'hello';
  readonly protocolVersion: number;
  readonly connectorVersion: string;
  readonly minecraftVersion: string;
  readonly kubejsVersion: string | null;
  readonly session?: ConnectorSession;
  readonly workspace?: ConnectorWorkspace;
  readonly capabilities: ConnectorCapabilities;
}

export interface ConnectorSession {
  readonly kind: 'admin' | 'player';
  readonly displayName: string;
  readonly playerId?: string;
  readonly sessionId?: string;
  readonly permissionLevel?: number;
}

export interface ConnectorWorkspace {
  readonly instancePath: string;
  readonly kubejsPath: string;
}

export interface ConnectorError {
  readonly type: 'error';
  readonly code:
    | 'AUTH_REQUIRED'
    | 'AUTH_FAILED'
    | 'PERMISSION_DENIED'
    | 'PROTOCOL_MISMATCH'
    | 'INVALID_MESSAGE'
    | 'RATE_LIMITED'
    | 'FILE_ERROR'
    | 'LOCK_REQUIRED'
    | 'REVISION_CONFLICT'
    | 'INTERNAL_ERROR';
  readonly message: string;
  readonly requestId?: string;
  readonly actualRevision?: string;
}

export interface ConnectorRequest {
  readonly type: 'request';
  readonly requestId: string;
  readonly method: string;
  readonly params?: Readonly<Record<string, unknown>>;
}

export interface ConnectorResponse {
  readonly type: 'response';
  readonly requestId: string;
  readonly ok: true;
  readonly result: unknown;
}

export interface PagedIds {
  readonly entries: readonly string[];
  readonly offset: number;
  readonly total: number;
  readonly hasMore: boolean;
}

export interface NamedRegistryEntry {
  readonly id: string;
  readonly name: string;
  readonly translationKey: string | null;
}

export interface PagedRegistryEntries {
  readonly entries: readonly NamedRegistryEntry[];
  readonly offset: number;
  readonly total: number;
  readonly hasMore: boolean;
}

export interface RegistrySearchEntry extends NamedRegistryEntry {
  readonly registry: string;
}

export interface RegistrySearchResult {
  readonly entries: readonly RegistrySearchEntry[];
  readonly total: number;
  readonly truncated: boolean;
}

export interface RegistryIconResult {
  readonly id: string;
  readonly dataUri: string | null;
}

export interface RecipeSnapshotEntry {
  readonly id: string;
  readonly recipeType: string;
  readonly json: unknown;
}

export interface PagedRecipeSnapshots {
  readonly entries: readonly RecipeSnapshotEntry[];
  readonly offset: number;
  readonly total: number;
  readonly hasMore: boolean;
}


export interface ModEntry {
  readonly id: string;
  readonly name: string;
  readonly version: string;
}

export interface ModSnapshot {
  readonly entries: readonly ModEntry[];
  readonly total: number;
}

export type ConnectorMessage = ConnectorHello | ConnectorError | ConnectorResponse;

export function isConnectorMessage(value: unknown): value is ConnectorMessage {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return false;
  }
  if (value.type === 'hello') {
    return (
      typeof value.protocolVersion === 'number' &&
      typeof value.connectorVersion === 'string' &&
      typeof value.minecraftVersion === 'string' &&
      (typeof value.kubejsVersion === 'string' || value.kubejsVersion === null) &&
      (value.session === undefined ||
        (isRecord(value.session) &&
          (value.session.kind === 'admin' || value.session.kind === 'player') &&
          typeof value.session.displayName === 'string' &&
          value.session.displayName.length <= 64 &&
          (value.session.sessionId === undefined ||
            (typeof value.session.sessionId === 'string' &&
              value.session.sessionId.length >= 16 &&
              value.session.sessionId.length <= 128)) &&
          (value.session.permissionLevel === undefined ||
            (typeof value.session.permissionLevel === 'number' &&
              Number.isInteger(value.session.permissionLevel) &&
              value.session.permissionLevel >= 0 &&
              value.session.permissionLevel <= 4)) &&
          (value.session.playerId === undefined ||
            (typeof value.session.playerId === 'string' &&
              /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
                value.session.playerId,
              ))))) &&
      (value.workspace === undefined ||
        (isRecord(value.workspace) &&
          typeof value.workspace.instancePath === 'string' &&
          value.workspace.instancePath.length <= 4096 &&
          typeof value.workspace.kubejsPath === 'string' &&
          value.workspace.kubejsPath.length <= 4096)) &&
      isRecord(value.capabilities)
    );
  }
  if (value.type === 'response') {
    return typeof value.requestId === 'string' && value.ok === true && 'result' in value;
  }
  return (
    value.type === 'error' && typeof value.code === 'string' && typeof value.message === 'string'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
