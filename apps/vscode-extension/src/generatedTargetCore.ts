const SCRIPT_DIRECTORIES = new Set(['server_scripts', 'client_scripts', 'startup_scripts']);
const SAFE_SEGMENT = /^[a-z0-9_.-]+$/u;

export function generatedDirectorySegments(
  workspaceName: string,
  configuredDirectory: string,
  workspaceScheme = 'file',
): string[] {
  const segments = configuredDirectory.split(/[\\/]/u).filter(Boolean);
  if (segments.length === 0 || segments.some((segment) => segment === '.' || segment === '..')) {
    throw new Error('Папка kubevs.generatedFiles.directory должна находиться внутри проекта.');
  }

  const root = (workspaceScheme === 'kubevs-remote' ? 'kubejs' : workspaceName).toLocaleLowerCase(
    'en',
  );
  if (root === 'kubejs' && segments[0]?.toLocaleLowerCase('en') === 'kubejs') {
    segments.shift();
  } else if (SCRIPT_DIRECTORIES.has(root)) {
    if (segments[0]?.toLocaleLowerCase('en') === 'kubejs') segments.shift();
    if (segments[0]?.toLocaleLowerCase('en') === root) segments.shift();
  }
  return segments;
}

export function craftCategory(recipeType: string): string {
  const namespace = recipeType.split(':', 1)[0]?.toLocaleLowerCase('en') ?? '';
  if (namespace === 'create') return 'create';
  if (namespace === 'oritech') return 'oritech';
  if (namespace === 'farmersdelight') return 'farmersdelight';
  if (namespace === 'minecraft') return 'vanilla';
  return 'generic';
}

export function safeGeneratedSegment(value: string, fallback: string): string {
  const normalized = value.trim().toLocaleLowerCase('en');
  return SAFE_SEGMENT.test(normalized) ? normalized : fallback;
}

export function generatedArtifactStem(resourceId: string, fallbackName: string): string {
  const normalized = resourceId.trim().toLocaleLowerCase('en');
  const readable = normalized
    .replace(':', '__')
    .replaceAll('/', '_')
    .replace(/[^\p{L}\p{N}_.-]/gu, '_')
    .slice(0, 96);
  const safe = safeGeneratedSegment(readable, fallbackName);
  const hash = createHash('sha256').update(normalized).digest('hex').slice(0, 10);
  return `${safe}__${hash}`;
}
import { createHash } from 'node:crypto';
