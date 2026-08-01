import { generateKubeJs, importRecipeJson } from '@kubevs/recipe-model';

const RESOURCE_ID = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/u;

export interface RecipeReplacement {
  readonly targetId: string;
  readonly sourceId: string;
  readonly recipeType: string;
  readonly code: string;
  readonly warnings: readonly string[];
}

/**
 * Builds a complete managed KubeJS script which installs the source recipe under the target ID.
 * The source ID is intentionally never used as the generated recipe ID.
 */
export function buildRecipeReplacement(
  targetId: string,
  sourceId: string,
  sourceJson: unknown,
): RecipeReplacement {
  requireRecipeId(targetId, 'ID заменяемого рецепта');
  requireRecipeId(sourceId, 'ID рецепта-шаблона');

  const imported = importRecipeJson(targetId, sourceJson);
  const errors = imported.issues.filter((issue) => issue.severity === 'error');
  if (errors.length > 0) {
    throw new Error(errors.map((issue) => `${issue.path}: ${issue.message}`).join('\n'));
  }

  const expression = generateKubeJs(imported.recipe);
  return {
    targetId,
    sourceId,
    recipeType: imported.recipe.recipeType,
    warnings: imported.issues
      .filter((issue) => issue.severity === 'warning')
      .map((issue) => `${issue.path}: ${issue.message}`),
    code: [
      '// Создано KubeVS: замена рецепта строго по ID.',
      `// Определение взято из ${sourceId}; в игре заменяется ${targetId}.`,
      'ServerEvents.recipes(event => {',
      indent(expression, 2),
      '})',
      '',
    ].join('\n'),
  };
}

export function isRecipeId(value: string): boolean {
  return RESOURCE_ID.test(value);
}

function requireRecipeId(value: string, label: string): void {
  if (!isRecipeId(value)) throw new Error(`${label}: ожидается namespace:path`);
}

function indent(value: string, spaces: number): string {
  const prefix = ' '.repeat(spaces);
  return value
    .split('\n')
    .map((line) => `${prefix}${line}`)
    .join('\n');
}
