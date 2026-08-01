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

export function defaultWorkstations(recipeType: string): readonly string[] {
  return DEFAULT_WORKSTATIONS[recipeType] ?? [];
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
