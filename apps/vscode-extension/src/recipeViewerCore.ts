export type RecipeViewerProvider = 'minecraft' | 'jei' | 'emi' | 'unknown';
export type RecipeViewerRole = 'input' | 'output' | 'catalyst' | 'render-only';
export type RecipeViewerStackKind = 'item' | 'tag' | 'fluid';

export interface RecipeViewerStack {
  readonly kind: RecipeViewerStackKind;
  readonly id: string;
  readonly count: number;
  readonly chance: number;
  readonly name?: string;
  readonly role: RecipeViewerRole;
  readonly slot?: number;
}

export interface RecipeViewerDisplay {
  readonly recipeId: string;
  readonly recipeType: string;
  readonly categoryId: string;
  readonly categoryName: string;
  readonly provider: RecipeViewerProvider;
  readonly inputs: readonly RecipeViewerStack[];
  readonly outputs: readonly RecipeViewerStack[];
  readonly catalysts: readonly RecipeViewerStack[];
  readonly workstations: readonly RecipeViewerStack[];
  readonly duration: number;
  readonly energy: number;
  readonly width?: number;
  readonly height?: number;
}

export interface RecipeViewerStatus {
  readonly available: boolean;
  readonly provider: RecipeViewerProvider;
  readonly version?: string;
  readonly displays: boolean;
  readonly workstations: boolean;
}

export interface PagedRecipeViewerDisplays {
  readonly entries: readonly RecipeViewerDisplay[];
  readonly offset: number;
  readonly total: number;
  readonly hasMore: boolean;
}

const RECIPE_LABELS: Readonly<Record<string, string>> = {
  'minecraft:crafting_shaped': 'Форменный крафт',
  'minecraft:crafting_shapeless': 'Бесформенный крафт',
  'minecraft:smelting': 'Плавка',
  'minecraft:blasting': 'Плавка в плавильной печи',
  'minecraft:smoking': 'Приготовление в коптильне',
  'minecraft:campfire_cooking': 'Приготовление на костре',
  'minecraft:stonecutting': 'Камнерез',
  'minecraft:smithing_transform': 'Кузнечный стол',
  'create:mixing': 'Смешивание',
  'create:compacting': 'Уплотнение',
  'create:pressing': 'Прессование',
  'create:crushing': 'Дробление',
  'create:milling': 'Измельчение',
  'create:cutting': 'Распиливание',
  'create:deploying': 'Установка компонентом',
  'create:filling': 'Наполнение жидкостью',
  'create:emptying': 'Опустошение',
  'create:splashing': 'Промывание',
  'create:haunting': 'Обработка душами',
  'create:sandpaper_polishing': 'Полировка наждачной бумагой',
  'create:mechanical_crafting': 'Механический крафт',
  'create:sequenced_assembly': 'Последовательная сборка',
  'farmersdelight:cutting': 'Разделочная доска',
  'farmersdelight:cooking': 'Приготовление в котле',
  'oritech:grinder': 'Измельчение в дробилке',
  'oritech:pulverizer': 'Дробление',
  'oritech:assembler': 'Сборка',
};

const DEFAULT_WORKSTATIONS: Readonly<Record<string, readonly string[]>> = {
  'minecraft:crafting_shaped': ['minecraft:crafting_table'],
  'minecraft:crafting_shapeless': ['minecraft:crafting_table'],
  'minecraft:smelting': ['minecraft:furnace'],
  'minecraft:blasting': ['minecraft:blast_furnace'],
  'minecraft:smoking': ['minecraft:smoker'],
  'minecraft:stonecutting': ['minecraft:stonecutter'],
  'minecraft:smithing_transform': ['minecraft:smithing_table'],
  'create:mixing': ['create:mechanical_mixer', 'create:basin'],
  'create:compacting': ['create:mechanical_press', 'create:basin'],
  'create:pressing': ['create:mechanical_press', 'create:depot'],
  'create:crushing': ['create:crushing_wheel'],
  'create:milling': ['create:millstone'],
  'create:cutting': ['create:mechanical_saw'],
  'create:deploying': ['create:deployer', 'create:depot'],
  'create:filling': ['create:spout', 'create:depot'],
  'create:emptying': ['create:item_drain'],
  'create:splashing': ['create:encased_fan'],
  'create:haunting': ['create:encased_fan'],
  'create:mechanical_crafting': ['create:mechanical_crafter'],
  'farmersdelight:cutting': ['farmersdelight:cutting_board'],
  'farmersdelight:cooking': ['farmersdelight:cooking_pot'],
};

export function canonicalRecipeLabel(recipeType: string, categoryName?: string): string {
  const explicit = cleanText(categoryName, 120);
  if (explicit && !looksLikeResourceId(explicit)) return explicit;
  const known = RECIPE_LABELS[recipeType];
  if (known) return known;
  const path = recipeType.includes(':')
    ? recipeType.slice(recipeType.indexOf(':') + 1)
    : recipeType;
  return path
    .replaceAll('/', ' · ')
    .replaceAll('_', ' ')
    .replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase('ru-RU'));
}

export function defaultWorkstations(recipeType: string): readonly RecipeViewerStack[] {
  return (DEFAULT_WORKSTATIONS[recipeType] ?? []).map((id) => ({
    kind: 'item',
    id,
    count: 1,
    chance: 1,
    role: 'render-only',
  }));
}

export function parseRecipeViewerStatus(value: unknown): RecipeViewerStatus | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const provider = parseProvider(record.provider);
  const available = record.available === true;
  return {
    available,
    provider: available ? provider : 'unknown',
    ...(typeof record.version === 'string' && record.version.length <= 100
      ? { version: record.version }
      : {}),
    displays: record.displays === true,
    workstations: record.workstations === true,
  };
}

export function parseRecipeViewerPage(value: unknown): PagedRecipeViewerDisplays | undefined {
  const record = asRecord(value);
  if (
    !record ||
    !Array.isArray(record.entries) ||
    record.entries.length > 1000 ||
    !safeInteger(record.offset, 0, 1_000_000) ||
    !safeInteger(record.total, 0, 1_000_000) ||
    typeof record.hasMore !== 'boolean'
  ) {
    return undefined;
  }
  const entries = record.entries
    .map(parseRecipeViewerDisplay)
    .filter((entry): entry is RecipeViewerDisplay => entry !== undefined);
  return {
    entries,
    offset: record.offset,
    total: record.total,
    hasMore: record.hasMore,
  };
}

export function parseRecipeViewerDisplay(value: unknown): RecipeViewerDisplay | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const recipeId = resourceId(record.recipeId ?? record.id);
  const recipeType = resourceId(record.recipeType ?? record.type);
  const categoryId = resourceId(record.categoryId ?? record.category ?? recipeType);
  if (!recipeId || !recipeType || !categoryId) return undefined;
  const provider = parseProvider(record.provider ?? record.source);
  const inputs = parseStackArray(record.inputs, 'input');
  const outputs = parseStackArray(record.outputs ?? record.results, 'output');
  if (outputs.length === 0) return undefined;
  const catalysts = parseStackArray(record.catalysts, 'catalyst');
  const workstations = parseStackArray(record.workstations, 'render-only');
  return {
    recipeId,
    recipeType,
    categoryId,
    categoryName: canonicalRecipeLabel(
      recipeType,
      cleanText(record.categoryName ?? record.title, 120),
    ),
    provider,
    inputs,
    outputs,
    catalysts,
    workstations: workstations.length > 0 ? workstations : defaultWorkstations(recipeType),
    duration: finiteNonNegative(record.duration ?? record.processingTime),
    energy: finiteNonNegative(record.energy ?? record.energyCost),
    ...(safeInteger(record.width, 1, 2048) ? { width: record.width } : {}),
    ...(safeInteger(record.height, 1, 2048) ? { height: record.height } : {}),
  };
}

export function mergeRecipeViewerDisplays(
  entries: readonly RecipeViewerDisplay[],
): readonly RecipeViewerDisplay[] {
  const score = (provider: RecipeViewerProvider): number =>
    provider === 'emi' ? 3 : provider === 'jei' ? 2 : provider === 'minecraft' ? 1 : 0;
  const merged = new Map<string, RecipeViewerDisplay>();
  for (const entry of entries) {
    const key = `${entry.recipeId}\0${entry.categoryId}`;
    const current = merged.get(key);
    if (!current || score(entry.provider) > score(current.provider)) merged.set(key, entry);
  }
  return [...merged.values()].sort((left, right) =>
    left.recipeId.localeCompare(right.recipeId, 'en'),
  );
}

export function recipeViewerCapability(value: unknown): boolean {
  const record = asRecord(value);
  if (!record) return false;
  return (
    record.recipeViewer === true ||
    record.recipeDisplays === true ||
    (Array.isArray(record.integrations) &&
      record.integrations.some((entry) => entry === 'jei' || entry === 'emi'))
  );
}

function parseStackArray(value: unknown, role: RecipeViewerRole): RecipeViewerStack[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 256)
    .map((entry) => parseStack(entry, role))
    .filter((entry): entry is RecipeViewerStack => entry !== undefined);
}

function parseStack(value: unknown, role: RecipeViewerRole): RecipeViewerStack | undefined {
  if (typeof value === 'string') {
    const tagged = value.startsWith('#');
    const id = resourceId(tagged ? value.slice(1) : value);
    return id ? { kind: tagged ? 'tag' : 'item', id, count: 1, chance: 1, role } : undefined;
  }
  const record = asRecord(value);
  if (!record) return undefined;
  const tagged = typeof record.tag === 'string';
  const fluid = typeof record.fluid === 'string';
  const id = resourceId(record.id ?? record.item ?? record.fluid ?? record.tag);
  if (!id) return undefined;
  const name = cleanText(record.name ?? record.displayName, 160);
  return {
    kind: fluid ? 'fluid' : tagged ? 'tag' : 'item',
    id,
    count: positive(record.count ?? record.amount, 1),
    chance: probability(record.chance),
    ...(name === undefined ? {} : { name }),
    role,
    ...(safeInteger(record.slot, 0, 4096) ? { slot: record.slot } : {}),
  };
}

function parseProvider(value: unknown): RecipeViewerProvider {
  return value === 'minecraft' || value === 'jei' || value === 'emi' ? value : 'unknown';
}

function probability(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 1;
  return value > 1 ? Math.min(value / 100, 1) : Math.min(value, 1);
}

function positive(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function finiteNonNegative(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function safeInteger(value: unknown, minimum: number, maximum: number): value is number {
  return (
    typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum
  );
}

function resourceId(value: unknown): string | undefined {
  return typeof value === 'string' && looksLikeResourceId(value) && value.length <= 300
    ? value
    : undefined;
}

function looksLikeResourceId(value: string): boolean {
  return /^[a-z0-9_.-]+:[a-z0-9_./-]+$/u.test(value);
}

function cleanText(value: unknown, maximum: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const cleaned = [...value.trim()]
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint > 0x1f && codePoint !== 0x7f;
    })
    .join('');
  return cleaned.length > 0 && cleaned.length <= maximum ? cleaned : undefined;
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}
