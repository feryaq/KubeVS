import * as vscode from 'vscode';
import type { NamedRegistryEntry, PagedIds, PagedRegistryEntries } from '@kubevs/protocol';
import type { ConnectorClient } from './connectorClient.js';

export interface RegistryPickOptions {
  readonly registry?: string;
  readonly includeTags?: boolean;
  readonly title?: string;
  readonly current?: string;
}

export interface RegistrySuggestion extends NamedRegistryEntry {
  readonly registry: string;
  readonly source: 'minecraft' | 'project' | 'builtin' | 'tag';
}

interface CatalogEntry extends NamedRegistryEntry {
  readonly source: 'minecraft' | 'project' | 'builtin' | 'tag';
}

interface RegistryChoice extends vscode.QuickPickItem {
  readonly registry: string;
  readonly includeTags: boolean;
}

interface RegistryList {
  readonly entries: readonly string[];
  readonly total: number;
}

interface RegistrySearchResult {
  readonly entries: readonly (NamedRegistryEntry & { readonly registry: string })[];
  readonly total: number;
  readonly truncated: boolean;
}

interface RegistryIconResult {
  readonly id: string;
  readonly dataUri: string | null;
}

interface RegistryIconsResult {
  readonly entries: Readonly<Record<string, string>>;
}

const KNOWN_REGISTRIES: readonly RegistryChoice[] = [
  {
    label: 'Предметы',
    description: 'minecraft:item',
    detail: 'Ингредиенты, результаты, инструменты и добыча',
    registry: 'minecraft:item',
    includeTags: true,
  },
  {
    label: 'Блоки',
    description: 'minecraft:block',
    detail: 'Блоки и теги блоков',
    registry: 'minecraft:block',
    includeTags: true,
  },
  {
    label: 'Жидкости',
    description: 'minecraft:fluid',
    detail: 'Жидкости и теги жидкостей',
    registry: 'minecraft:fluid',
    includeTags: true,
  },
  {
    label: 'Сущности',
    description: 'minecraft:entity_type',
    detail: 'Мобы и другие типы сущностей',
    registry: 'minecraft:entity_type',
    includeTags: true,
  },
  {
    label: 'Структуры мира',
    description: 'minecraft:worldgen/structure',
    detail: 'Деревни, крепости, данжи и структуры модов',
    registry: 'minecraft:worldgen/structure',
    includeTags: false,
  },
  {
    label: 'Биомы',
    description: 'minecraft:worldgen/biome',
    detail: 'Биомы Minecraft и модов',
    registry: 'minecraft:worldgen/biome',
    includeTags: true,
  },
];

const BUILTIN_NAMES: Readonly<Record<string, string>> = {
  'minecraft:air': 'Воздух',
  'minecraft:stone': 'Камень',
  'minecraft:dirt': 'Земля',
  'minecraft:grass_block': 'Дёрн',
  'minecraft:cobblestone': 'Булыжник',
  'minecraft:oak_log': 'Дубовое бревно',
  'minecraft:iron_ingot': 'Железный слиток',
  'minecraft:gold_ingot': 'Золотой слиток',
  'minecraft:diamond': 'Алмаз',
  'minecraft:netherite_ingot': 'Незеритовый слиток',
  'minecraft:stick': 'Палка',
  'minecraft:chest': 'Сундук',
  'minecraft:iron_pickaxe': 'Железная кирка',
  'minecraft:zombie': 'Зомби',
  'minecraft:skeleton': 'Скелет',
  'minecraft:water': 'Вода',
  'minecraft:lava': 'Лава',
};

export class RegistryCatalog {
  private readonly liveCache = new Map<string, readonly CatalogEntry[]>();
  private readonly suggestionCache = new Map<string, readonly RegistrySuggestion[]>();
  private readonly suggestionRequests = new Map<string, Promise<readonly RegistrySuggestion[]>>();
  private readonly iconCache = new Map<string, string | null>();
  private readonly tagEntryCache = new Map<string, readonly string[]>();
  private readonly iconRequests = new Map<string, Promise<string | undefined>>();
  private projectCache: readonly CatalogEntry[] | undefined;
  private projectCachePromise: Promise<readonly CatalogEntry[]> | undefined;
  private projectCacheRevision = 0;

  constructor(private readonly connector: ConnectorClient) {}

  clearLiveCache(): void {
    this.liveCache.clear();
    this.suggestionCache.clear();
    this.suggestionRequests.clear();
    this.iconCache.clear();
    this.tagEntryCache.clear();
    this.iconRequests.clear();
  }

  clearProjectCache(): void {
    this.projectCache = undefined;
    this.projectCacheRevision++;
  }

  async suggestions(query: string): Promise<readonly RegistrySuggestion[]> {
    const normalized = query.trim().toLocaleLowerCase('ru');
    const cached = this.suggestionCache.get(normalized);
    if (cached) return cached;
    const pending = this.suggestionRequests.get(normalized);
    if (pending) return await pending;

    const request = this.searchSuggestions(normalized);
    this.suggestionRequests.set(normalized, request);
    try {
      const entries = await request;
      this.suggestionCache.set(normalized, entries);
      return entries;
    } finally {
      if (this.suggestionRequests.get(normalized) === request) {
        this.suggestionRequests.delete(normalized);
      }
    }
  }

  async tagEntries(tag: string, registry = 'minecraft:item'): Promise<readonly string[]> {
    const normalized = tag.replace(/^#/u, '');
    const cacheKey = `${registry}:${normalized}`;
    const cached = this.tagEntryCache.get(cacheKey);
    if (cached) return cached;
    try {
      const entries = await this.fetchIds('registry.tagEntries', { registry, tag: normalized });
      this.tagEntryCache.set(cacheKey, entries);
      return entries;
    } catch {
      return [];
    }
  }
  async iconDataUri(id: string): Promise<string | undefined> {
    if (id.startsWith('#')) return undefined;
    if (this.iconCache.has(id)) return this.iconCache.get(id) ?? undefined;
    const pending = this.iconRequests.get(id);
    if (pending) return await pending;
    const request = this.fetchIcon(id);
    this.iconRequests.set(id, request);
    try {
      const icon = await request;
      this.cacheIcon(id, icon ?? null);
      return icon;
    } finally {
      if (this.iconRequests.get(id) === request) this.iconRequests.delete(id);
    }
  }

  async iconDataUris(ids: readonly string[]): Promise<Readonly<Record<string, string>>> {
    const unique = [...new Set(ids.filter((id) => !id.startsWith('#')))].slice(0, 128);
    const result: Record<string, string> = {};
    const missing: string[] = [];
    for (const id of unique) {
      if (this.iconCache.has(id)) {
        const cached = this.iconCache.get(id);
        if (cached) result[id] = cached;
      } else {
        missing.push(id);
      }
    }
    if (missing.length === 0) return result;
    try {
      const batch = await this.connector.request<RegistryIconsResult>('registry.icons', {
        ids: missing,
      });
      for (const id of missing) {
        const icon = batch.entries[id];
        this.cacheIcon(id, icon ?? null);
        if (icon) result[id] = icon;
      }
    } catch {
      for (const id of missing) this.cacheIcon(id, null);
    }
    return result;
  }

  private cacheIcon(id: string, icon: string | null): void {
    const limit = Math.max(
      0,
      vscode.workspace.getConfiguration('kubevs.registry').get('iconCacheSize', 500),
    );
    if (limit === 0) return;
    this.iconCache.delete(id);
    this.iconCache.set(id, icon);
    while (this.iconCache.size > limit) {
      const oldest = this.iconCache.keys().next().value;
      if (oldest === undefined) break;
      this.iconCache.delete(oldest);
    }
  }

  async pick(options: RegistryPickOptions = {}): Promise<string | undefined> {
    let registry = options.registry;
    let includeTags = options.includeTags ?? false;
    if (!registry) {
      const choice = await vscode.window.showQuickPick(await this.registryChoices(), {
        title: options.title ?? 'KubeVS — поиск игрового ID',
        placeHolder: 'Что нужно найти?',
        matchOnDescription: true,
        matchOnDetail: true,
      });
      if (!choice) return undefined;
      registry = choice.registry;
      includeTags = choice.includeTags;
    }

    const entries = await this.entries(registry, includeTags);
    const items = entries.map((entry) => ({
      label: entry.name,
      description: entry.id,
      detail:
        entry.source === 'minecraft'
          ? entry.translationKey
            ? `Minecraft · ${entry.translationKey}`
            : 'Minecraft · live registry'
          : entry.source === 'tag'
            ? 'Тег из подключённого Minecraft'
            : entry.source === 'project'
              ? 'Найдено в открытом проекте · Offline Mode'
              : 'Встроенная подсказка · Offline Mode',
      entry,
    }));
    const selected = await vscode.window.showQuickPick(items, {
      title: options.title ?? registryTitle(registry),
      placeHolder: 'Введите имя в игре или ID, например «алмаз» или minecraft:diamond',
      matchOnDescription: true,
      matchOnDetail: true,
    });
    return selected?.entry.id;
  }

  async searchAndCopy(): Promise<void> {
    const selected = await this.pick();
    if (!selected) return;
    await vscode.env.clipboard.writeText(selected);
    void vscode.window.showInformationMessage(`KubeVS: ${selected} скопирован в буфер обмена.`);
  }

  private async entries(registry: string, includeTags: boolean): Promise<readonly CatalogEntry[]> {
    const cacheKey = `${registry}:${includeTags}`;
    const cached = this.liveCache.get(cacheKey);
    if (cached) return cached;

    try {
      const live = await this.fetchLiveEntries(registry);
      if (includeTags) {
        const tags = await this.fetchIds('registry.tags', { registry });
        live.push(
          ...tags.map((id) => ({
            id: `#${id}`,
            name: `Тег: ${humanize(id)}`,
            translationKey: null,
            source: 'tag' as const,
          })),
        );
      }
      const sorted = sortEntries(live);
      this.liveCache.set(cacheKey, sorted);
      return sorted;
    } catch {
      const project = await this.projectEntries();
      const builtins = Object.entries(BUILTIN_NAMES).map(([id, name]): CatalogEntry => ({
        id,
        name,
        translationKey: null,
        source: 'builtin',
      }));
      return sortEntries(uniqueEntries([...builtins, ...project]));
    }
  }

  private async searchSuggestions(query: string): Promise<readonly RegistrySuggestion[]> {
    try {
      const result = await this.connector.request<RegistrySearchResult>('registry.search', {
        query,
        limit: 500,
      });
      return result.entries.map((entry) => ({
        ...entry,
        source: entry.id.startsWith('#') ? ('tag' as const) : ('minecraft' as const),
      }));
    } catch {
      const candidates = [
        ...Object.entries(BUILTIN_NAMES).map(([id, name]): RegistrySuggestion => ({
          id,
          name,
          translationKey: null,
          registry: inferRegistry(id),
          source: 'builtin',
        })),
        ...(await this.projectEntries()).map((entry): RegistrySuggestion => ({
          ...entry,
          registry: inferRegistry(entry.id),
        })),
      ];
      return sortSuggestions(
        uniqueSuggestions(candidates).filter((entry) => matches(entry, query)),
      ).slice(0, 500);
    }
  }

  private async fetchIcon(id: string): Promise<string | undefined> {
    try {
      const result = await this.connector.request<RegistryIconResult>('registry.icon', { id });
      return result.dataUri ?? undefined;
    } catch {
      return undefined;
    }
  }

  private async registryChoices(): Promise<readonly RegistryChoice[]> {
    try {
      const result = await this.connector.request<RegistryList>('registry.list');
      return result.entries.map((registry) => {
        const known = KNOWN_REGISTRIES.find((entry) => entry.registry === registry);
        return (
          known ?? {
            label: humanize(registry),
            description: registry,
            detail: 'Игровой реестр из подключённого Minecraft',
            registry,
            includeTags: true,
          }
        );
      });
    } catch {
      return KNOWN_REGISTRIES;
    }
  }

  private async fetchLiveEntries(registry: string): Promise<CatalogEntry[]> {
    try {
      const values: CatalogEntry[] = [];
      let offset = 0;
      do {
        const page = await this.connector.request<PagedRegistryEntries>('registry.namedEntries', {
          registry,
          offset,
          limit: 500,
        });
        values.push(
          ...page.entries.map((entry) => ({
            id: entry.id,
            name: entry.name || humanize(entry.id),
            translationKey: entry.translationKey,
            source: 'minecraft' as const,
          })),
        );
        if (!page.hasMore) break;
        offset = page.offset + page.entries.length;
      } while (values.length < 100_000);
      return values;
    } catch (error) {
      if (!String(error).includes('Unsupported method')) throw error;
      const ids = await this.fetchIds('registry.entries', { registry });
      return ids.map((id) => ({
        id,
        name: humanize(id),
        translationKey: null,
        source: 'minecraft',
      }));
    }
  }

  private async fetchIds(
    method: string,
    params: Readonly<Record<string, unknown>>,
  ): Promise<string[]> {
    const values: string[] = [];
    let offset = 0;
    do {
      const page = await this.connector.request<PagedIds>(method, {
        ...params,
        offset,
        limit: 500,
      });
      values.push(...page.entries);
      if (!page.hasMore) break;
      offset = page.offset + page.entries.length;
    } while (values.length < 100_000);
    return values;
  }

  private async projectEntries(): Promise<readonly CatalogEntry[]> {
    if (this.projectCache) return this.projectCache;
    if (this.projectCachePromise) return await this.projectCachePromise;
    const revision = this.projectCacheRevision;
    const pending = this.scanProjectEntries();
    this.projectCachePromise = pending;
    try {
      const entries = await pending;
      if (revision === this.projectCacheRevision) this.projectCache = entries;
      return entries;
    } finally {
      if (this.projectCachePromise === pending) this.projectCachePromise = undefined;
    }
  }

  private async scanProjectEntries(): Promise<readonly CatalogEntry[]> {
    const files = await vscode.workspace.findFiles(
      '**/*.{js,ts,json,json5}',
      '**/{node_modules,.git,build,.gradle,.kubevs/cache}/**',
      1000,
    );
    const ids = new Set<string>();
    let bytesRead = 0;
    for (const file of files) {
      if (bytesRead >= 8 * 1024 * 1024) break;
      try {
        const bytes = await vscode.workspace.fs.readFile(file);
        bytesRead += bytes.length;
        const text = new TextDecoder().decode(bytes);
        for (const match of text.matchAll(/#?[a-z0-9_.-]+:[a-z0-9_./-]+/gu)) {
          if (match[0].length <= 300) ids.add(match[0]);
        }
      } catch {
        // Unreadable project files do not block Offline Mode search.
      }
    }
    return [...ids].map((id) => ({
      id,
      name: humanize(id.replace(/^#/u, '')),
      translationKey: null,
      source: 'project',
    }));
  }
}

function registryTitle(registry: string): string {
  return `KubeVS — ${KNOWN_REGISTRIES.find((entry) => entry.registry === registry)?.label ?? humanize(registry)}`;
}

function humanize(id: string): string {
  const path = id.split(':').at(-1) ?? id;
  return path
    .replaceAll('/', ' › ')
    .replaceAll('_', ' ')
    .replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
}

function uniqueEntries(entries: readonly CatalogEntry[]): CatalogEntry[] {
  const unique = new Map<string, CatalogEntry>();
  for (const entry of entries) {
    if (!unique.has(entry.id)) unique.set(entry.id, entry);
  }
  return [...unique.values()];
}

function sortEntries(entries: readonly CatalogEntry[]): CatalogEntry[] {
  return [...entries].sort(
    (left, right) =>
      left.name.localeCompare(right.name, 'ru') || left.id.localeCompare(right.id, 'en'),
  );
}

function inferRegistry(id: string): string {
  const normalized = id.replace(/^#/u, '');
  if (
    normalized.includes('fluid') ||
    normalized.endsWith(':water') ||
    normalized.endsWith(':lava')
  ) {
    return 'minecraft:fluid';
  }
  return 'minecraft:item';
}

function matches(entry: RegistrySuggestion, query: string): boolean {
  if (!query) return true;
  const haystack = `${entry.name} ${entry.id} ${entry.translationKey ?? ''}`.toLocaleLowerCase(
    'ru',
  );
  return haystack.includes(query);
}

function uniqueSuggestions(entries: readonly RegistrySuggestion[]): RegistrySuggestion[] {
  const unique = new Map<string, RegistrySuggestion>();
  for (const entry of entries) {
    const key = `${entry.registry}:${entry.id}`;
    if (!unique.has(key)) unique.set(key, entry);
  }
  return [...unique.values()];
}

function sortSuggestions(entries: readonly RegistrySuggestion[]): RegistrySuggestion[] {
  return [...entries].sort(
    (left, right) =>
      left.name.localeCompare(right.name, 'ru') || left.id.localeCompare(right.id, 'en'),
  );
}
