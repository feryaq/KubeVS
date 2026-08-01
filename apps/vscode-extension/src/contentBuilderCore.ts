export type ContentKind = 'item' | 'block';

export interface ContentBuilderDraft {
  readonly kind: ContentKind;
  readonly id: string;
  readonly displayName: string;
  readonly textureItem: string;
  readonly maxStackSize: number;
  readonly rarity: 'common' | 'uncommon' | 'rare' | 'epic';
  readonly glow: boolean;
  readonly tooltip: string;
  readonly hardness: number;
  readonly resistance: number;
  readonly soundType: 'stone' | 'metal' | 'wood' | 'glass' | 'wool';
  readonly requiresTool: boolean;
  readonly miningTool: 'pickaxe' | 'axe' | 'shovel' | 'hoe' | 'none';
}

const RESOURCE_ID = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/u;
const CONTENT_KINDS = new Set<ContentKind>(['item', 'block']);
const RARITIES = new Set<ContentBuilderDraft['rarity']>(['common', 'uncommon', 'rare', 'epic']);
const SOUND_TYPES = new Set<ContentBuilderDraft['soundType']>([
  'stone',
  'metal',
  'wood',
  'glass',
  'wool',
]);
const MINING_TOOLS = new Set<ContentBuilderDraft['miningTool']>([
  'pickaxe',
  'axe',
  'shovel',
  'hoe',
  'none',
]);

export function generateContentScript(draft: ContentBuilderDraft): string {
  validateContentDraft(draft);
  const create = draft.kind === 'item' ? generateItemBuilder(draft) : generateBlockBuilder(draft);
  return `// Создано KubeVS. Этот файл можно безопасно редактировать вручную.\nStartupEvents.registry(${quoted(draft.kind)}, event => {\n${create}\n})\n`;
}

export function validateContentDraft(draft: ContentBuilderDraft): void {
  if (!CONTENT_KINDS.has(draft.kind)) throw new Error('Неизвестный тип создаваемого контента.');
  if (typeof draft.id !== 'string') throw new Error('ID должен быть строкой.');
  if (!RESOURCE_ID.test(draft.id)) throw new Error('ID должен иметь формат namespace:name.');
  if (typeof draft.displayName !== 'string') throw new Error('Название должно быть строкой.');
  if (!draft.displayName.trim()) throw new Error('Укажите название в игре.');
  if (draft.displayName.length > 120) throw new Error('Название не должно превышать 120 символов.');
  if (typeof draft.textureItem !== 'string') throw new Error('ID иконки должен быть строкой.');
  if (draft.textureItem && !RESOURCE_ID.test(draft.textureItem)) {
    throw new Error('Образец иконки должен быть игровым ID.');
  }
  if (!RARITIES.has(draft.rarity)) throw new Error('Выбрана неизвестная редкость.');
  if (typeof draft.glow !== 'boolean') throw new Error('Параметр свечения должен быть логическим.');
  if (typeof draft.tooltip !== 'string' || draft.tooltip.length > 2_000) {
    throw new Error('Подсказка должна быть строкой не длиннее 2000 символов.');
  }
  if (!SOUND_TYPES.has(draft.soundType)) throw new Error('Выбран неизвестный тип звука.');
  if (typeof draft.requiresTool !== 'boolean') {
    throw new Error('Требование инструмента должно быть логическим.');
  }
  if (!MINING_TOOLS.has(draft.miningTool)) throw new Error('Выбран неизвестный инструмент.');
  if (draft.kind === 'block' && draft.requiresTool && draft.miningTool === 'none') {
    throw new Error('Для требования подходящего инструмента выберите его тип.');
  }
  if (
    !Number.isSafeInteger(draft.maxStackSize) ||
    draft.maxStackSize < 1 ||
    draft.maxStackSize > 64
  ) {
    throw new Error('Размер стака должен быть целым числом от 1 до 64.');
  }
  for (const [label, value] of [
    ['Твёрдость', draft.hardness],
    ['Взрывоустойчивость', draft.resistance],
  ] as const) {
    if (!Number.isFinite(value) || value < 0 || value > 3_600_000) {
      throw new Error(`${label}: ожидается число от 0 до 3600000.`);
    }
  }
}

export function suggestedContentId(displayName: string, fallback = 'new_content'): string {
  const transliterated = displayName
    .trim()
    .toLocaleLowerCase('ru')
    .replace(/[а-яё]/gu, (character) => TRANSLITERATION[character] ?? '')
    .replace(/[^a-z0-9_.-]+/gu, '_')
    .replace(/^_+|_+$/gu, '')
    .slice(0, 80);
  return `kubejs:${transliterated || fallback}`;
}

function generateItemBuilder(draft: ContentBuilderDraft): string {
  const lines = [
    `  event.create(${quoted(draft.id)})`,
    `    .displayName(${quoted(draft.displayName.trim())})`,
    `    .maxStackSize(${draft.maxStackSize})`,
    `    .rarity(${quoted(draft.rarity)})`,
  ];
  if (draft.glow) lines.push('    .glow(true)');
  if (draft.tooltip.trim()) lines.push(`    .tooltip(${quoted(draft.tooltip.trim())})`);
  return lines.join('\n');
}

function generateBlockBuilder(draft: ContentBuilderDraft): string {
  const lines = [
    `  event.create(${quoted(draft.id)})`,
    `    .displayName(${quoted(draft.displayName.trim())})`,
    `    .soundType(${quoted(draft.soundType)})`,
    `    .hardness(${draft.hardness})`,
    `    .resistance(${draft.resistance})`,
  ];
  if (draft.requiresTool) lines.push('    .requiresTool(true)');
  if (draft.miningTool !== 'none') {
    lines.push(`    .tagBlock(${quoted(`minecraft:mineable/${draft.miningTool}`)})`);
  }
  return lines.join('\n');
}

function quoted(value: string): string {
  return JSON.stringify(value);
}

const TRANSLITERATION: Readonly<Record<string, string>> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'h',
  ц: 'c',
  ч: 'ch',
  ш: 'sh',
  щ: 'sch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
};
