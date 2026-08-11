const RECIPE_LABELS: Readonly<Record<string, string>> = {
  'minecraft:crafting_shaped': 'Shaped Crafting',
  'minecraft:crafting_shapeless': 'Shapeless Crafting',
  'minecraft:smelting': 'Smelting',
  'minecraft:blasting': 'Blasting',
  'minecraft:smoking': 'Smoking',
  'minecraft:campfire_cooking': 'Campfire Cooking',
  'minecraft:stonecutting': 'Stonecutting',
  'minecraft:smithing_transform': 'Smithing',
  'create:mixing': 'Mixing',
  'create:compacting': 'Compacting',
  'create:pressing': 'Pressing',
  'create:crushing': 'Crushing',
  'create:milling': 'Milling',
  'create:cutting': 'Cutting',
  'create:deploying': 'Deploying',
  'create:filling': 'Filling',
  'create:emptying': 'Emptying',
  'create:splashing': 'Splashing',
  'create:haunting': 'Haunting',
  'create:sandpaper_polishing': 'Sandpaper Polishing',
  'create:mechanical_crafting': 'Mechanical Crafting',
  'create:sequenced_assembly': 'Sequenced Assembly',
  'farmersdelight:cutting': 'Cutting Board',
  'farmersdelight:cooking': 'Cooking Pot',
  'oritech:grinder': 'Grinding',
  'oritech:pulverizer': 'Pulverizing',
  'oritech:assembler': 'Assembly',
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
    .replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase('en-US'));
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
