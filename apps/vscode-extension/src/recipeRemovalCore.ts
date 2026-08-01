const RESOURCE_ID = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/u;

export function parseRemovedRecipeIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter(
        (entry): entry is string =>
          typeof entry === 'string' && entry.length <= 300 && RESOURCE_ID.test(entry),
      ),
    ),
  ].sort();
}

export function withRemovedRecipe(ids: readonly string[], recipeId: string): string[] {
  if (!RESOURCE_ID.test(recipeId)) throw new Error(`Некорректный ID рецепта: ${recipeId}`);
  return [...new Set([...ids, recipeId])].sort();
}

export function withoutRemovedRecipe(ids: readonly string[], recipeId: string): string[] {
  return ids.filter((id) => id !== recipeId).sort();
}

export function generateRecipeRemovalScript(ids: readonly string[]): string {
  const lines = parseRemovedRecipeIds(ids).map(
    (id) => `  event.remove({ id: ${JSON.stringify(id)} })`,
  );
  return `// Создано KubeVS. Управляйте списком через команды удаления и восстановления рецептов.\nServerEvents.recipes(event => {\n${lines.join('\n')}${lines.length > 0 ? '\n' : ''}})\n`;
}
