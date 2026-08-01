import type * as vscode from 'vscode';
import type { RegistryCatalog } from './registryCatalog.js';

interface RegistryPickRequest {
  readonly type: 'pickRegistry';
  readonly requestId: number;
  readonly registry?: string;
  readonly includeTags?: boolean;
  readonly current?: string;
  readonly title?: string;
}

interface RegistryIconRequest {
  readonly type: 'resolveRegistryIcon';
  readonly requestId: number;
  readonly value: string;
}

export async function handleRegistryIconMessage(
  value: unknown,
  webview: vscode.Webview,
  catalog: RegistryCatalog,
): Promise<boolean> {
  if (!isRegistryIconRequest(value)) return false;
  const icon = await catalog.iconDataUri(value.value);
  await webview.postMessage({
    type: 'registryIcon',
    requestId: value.requestId,
    value: value.value,
    icon,
  });
  return true;
}

export async function handleRegistryPickMessage(
  value: unknown,
  webview: vscode.Webview,
  catalog: RegistryCatalog,
): Promise<boolean> {
  if (!isRegistryPickRequest(value)) return false;
  const selected = await catalog.pick({
    ...(value.registry === undefined ? {} : { registry: value.registry }),
    ...(value.includeTags === undefined ? {} : { includeTags: value.includeTags }),
    ...(value.current === undefined ? {} : { current: value.current }),
    ...(value.title === undefined ? {} : { title: value.title }),
  });
  const icon = selected ? await catalog.iconDataUri(selected) : undefined;
  await webview.postMessage({
    type: 'registryPicked',
    requestId: value.requestId,
    value: selected,
    icon,
  });
  return true;
}

function isRegistryIconRequest(value: unknown): value is RegistryIconRequest {
  if (typeof value !== 'object' || value === null) return false;
  const request = value as Partial<RegistryIconRequest>;
  return (
    request.type === 'resolveRegistryIcon' &&
    Number.isSafeInteger(request.requestId) &&
    (request.requestId ?? -1) >= 0 &&
    typeof request.value === 'string' &&
    request.value.length <= 300 &&
    /^[a-z0-9_.-]+:[a-z0-9_./-]+$/u.test(request.value)
  );
}

function isRegistryPickRequest(value: unknown): value is RegistryPickRequest {
  if (typeof value !== 'object' || value === null) return false;
  const request = value as Partial<RegistryPickRequest>;
  return (
    request.type === 'pickRegistry' &&
    Number.isSafeInteger(request.requestId) &&
    (request.requestId ?? -1) >= 0 &&
    (request.registry === undefined ||
      (typeof request.registry === 'string' && request.registry.length <= 200)) &&
    (request.includeTags === undefined || typeof request.includeTags === 'boolean') &&
    (request.current === undefined ||
      (typeof request.current === 'string' && request.current.length <= 300)) &&
    (request.title === undefined ||
      (typeof request.title === 'string' && request.title.length <= 200))
  );
}
