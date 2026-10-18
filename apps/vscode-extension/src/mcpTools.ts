import * as vscode from 'vscode';
import { z, type ZodRawShape } from 'zod';
import { analyzeKubeJs, classifyScriptPath } from '@kubevs/kubejs-parser';
import {
  buildRecipeFromSchema,
  generateKubeJs,
  importRecipeJson,
  parseRecipeSchema,
} from '@kubevs/recipe-model';
import type { ConnectorHello, PagedRecipeSnapshots } from '@kubevs/protocol';
import type { ConnectorClient } from './connectorClient.js';
import type { RegistryCatalog } from './registryCatalog.js';
import type { McpWorkspace } from './mcpWorkspace.js';
import type { KubeVsMcpResource, KubeVsMcpTool } from './mcpTypes.js';
import { generateAddonRecipe, isAddonRecipeDraft } from './addonRecipeCore.js';
import { generateContentScript } from './contentBuilderCore.js';
import {
  generateLootRule,
  isLootRuleDraft,
  LOOT_RULE_PRESETS,
  type LootConditionNode,
} from './lootRuleCore.js';
import { gregtechOperationControls } from './gregtechOperationControls.js';
import {
  generateGregtechRecipe,
  generateGregtechShapedRecipe,
  gregtechOperationNames,
  validateGregtechOperation,
} from './gregtechRecipeCore.js';
import { generatedArtifactStem, craftCategory } from './generatedTargetCore.js';
import {
  buildCraftTree,
  calculateCraftTotals,
  normalizeRecipe,
  type RecipeSnapshotEntry,
  type CraftRecipe,
} from './craftGraphCore.js';
import {
  generateRecipeRemovalScript,
  withRemovedRecipe,
  withoutRemovedRecipe,
} from './recipeRemovalCore.js';
import { buildRecipeReplacement } from './recipeReplacementCore.js';
import { loadRecipeSchemas } from './recipeSchemas.js';

function isMissingFile(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return code === 'ENOENT' || code === 'FILE_NOT_FOUND' || code === 'FileNotFound';
}

const id = z
  .string()
  .min(3)
  .max(300)
  .regex(/^[a-z0-9_.-]+:[a-z0-9_./-]+$/);
const text = z.string().max(512 * 1024);
const rootArg = z
  .string()
  .max(200)
  .optional()
  .describe(
    'Root ID returned by kubevs_project_roots. Defaults to connected server, otherwise first local KubeJS root.',
  );
const pathArg = z
  .string()
  .min(1)
  .max(1024)
  .describe('Relative path within the KubeJS root, e.g. server_scripts/recipes/example.js.');
const revision = z.string().min(1).max(256);
const page = {
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(200).default(60),
};
const conditionSchema: z.ZodType<LootConditionNode, z.ZodTypeDef, unknown> = z.lazy(() =>
  z
    .object({
      id: z.string().min(1).max(100),
      kind: z.enum([
        'and',
        'or',
        'not',
        'chance',
        'tool',
        'killedByPlayer',
        'survivesExplosion',
        'custom',
      ]),
      value: z.union([z.number(), z.string().max(16 * 1024)]).optional(),
      children: z.array(conditionSchema).max(100).default([]),
    })
    .transform(({ value, ...node }) => (value === undefined ? node : { ...node, value })),
);
const lootActionSchema = z.discriminatedUnion('kind', [
  z.object({
    id: z.string().min(1).max(100),
    kind: z.literal('add'),
    item: id,
    count: z.number().int().positive().default(1),
    chance: z.number().positive().max(1).default(1),
  }),
  z.object({
    id: z.string().min(1).max(100),
    kind: z.literal('remove'),
    filter: z.string().min(1).max(300),
  }),
  z.object({
    id: z.string().min(1).max(100),
    kind: z.literal('replace'),
    filter: z.string().min(1).max(300),
    replacement: id,
    preserveCount: z.boolean().default(true),
  }),
  z.object({
    id: z.string().min(1).max(100),
    kind: z.literal('experience'),
    amount: z.number().nonnegative(),
  }),
]);
const saveArgs = {
  root: rootArg,
  path: pathArg
    .optional()
    .describe(
      'Optional target path. The default is the same managed scripts directory used by KubeVS editors.',
    ),
  save: z
    .boolean()
    .default(false)
    .describe('false previews code; true saves it. Saving does not execute or reload Minecraft.'),
  expectedRevision: revision
    .nullable()
    .optional()
    .describe(
      'Required to replace an existing file: use the revision returned by read_file. Null/omitted means create only.',
    ),
};

export interface McpToolsContext {
  readonly connector: ConnectorClient;
  readonly catalog: RegistryCatalog;
  readonly workspace: McpWorkspace;
  readonly hello: () => ConnectorHello | undefined;
  readonly status: () => unknown;
  readonly refresh: () => Promise<void>;
  readonly connect: (code?: string) => Promise<void>;
  readonly disconnect: () => Promise<void>;
}

/** Every tool uses the same validated generators and Connector session as the UI. */
export function createMcpTools(ctx: McpToolsContext): readonly KubeVsMcpTool[] {
  const tools: KubeVsMcpTool[] = [];
  const tool = <S extends ZodRawShape>(
    name: string,
    description: string,
    inputSchema: S,
    run: (args: z.infer<z.ZodObject<S>>) => Promise<unknown>,
    readOnly = true,
  ): void => {
    const schema = z.object(inputSchema).strict();
    tools.push({
      name,
      description,
      inputSchema,
      annotations: { readOnlyHint: readOnly, destructiveHint: !readOnly, openWorldHint: false },
      run: async (args) => {
        if (!vscode.workspace.isTrusted)
          throw new Error('MCP requires a trusted VS Code workspace.');
        return run(schema.parse(args));
      },
    });
  };
  const connected = (): ConnectorHello => {
    const hello = ctx.hello();
    if (!hello)
      throw new Error(
        'Minecraft is disconnected. Connect KubeVS using /kvs join in VS Code first.',
      );
    return hello;
  };
  const request = async (
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<unknown> => {
    connected();
    return ctx.connector.request(method, params);
  };
  const saveCode = async (
    args: z.infer<z.ZodObject<typeof saveArgs>>,
    code: string,
    path: string,
    requires: 'kubejs' | 'lootjs' = 'kubejs',
    restart = false,
  ): Promise<unknown> => {
    const hello = ctx.hello();
    const roots = await ctx.workspace.roots();
    const selected = roots.find((r) => r.id === args.root) ?? (args.root ? undefined : roots[0]);
    const requirements = [
      requires === 'lootjs' ? 'KubeJS and LootJS' : 'KubeJS',
      restart
        ? 'Restart Minecraft to register startup content.'
        : 'Reload server resources to apply server scripts.',
    ];
    if (!args.save) return { saved: false, path: args.path ?? path, code, requirements };
    if (selected?.remote) {
      if (hello?.kubejsVersion === null)
        throw new Error(
          'Install KubeJS on the connected server, restart and reconnect before saving generated scripts.',
        );
      if (requires === 'lootjs' && !hello?.capabilities.integrations.includes('lootjs'))
        throw new Error('Install LootJS on the connected server, restart and reconnect.');
    }
    const written = await ctx.workspace.write({ ...args, path: args.path ?? path, content: code });
    await ctx.refresh();
    return { saved: true, ...written, requirements, appliedInGame: false };
  };
  const recipeCode = (
    recipeId: string,
    json: unknown,
  ): { code: string; recipeType: string; warnings: unknown } => {
    const imported = importRecipeJson(recipeId, json);
    const errors = imported.issues.filter((issue) => issue.severity === 'error');
    if (errors.length)
      throw new Error(errors.map((issue) => `${issue.path}: ${issue.message}`).join('\n'));
    return {
      code: `ServerEvents.recipes(event => {\n${generateKubeJs(imported.recipe)
        .split('\n')
        .map((line) => `  ${line}`)
        .join('\n')}\n})\n`,
      recipeType: imported.recipe.recipeType,
      warnings: imported.issues,
    };
  };
  const recipePath = (recipeId: string, type: string): string =>
    `server_scripts/kubevs/crafts/${craftCategory(type)}/${generatedArtifactStem(recipeId, 'recipe')}.js`;

  tool(
    'kubevs_status',
    'Read the active project, Minecraft session, available capabilities and runtime requirements. Never returns credentials.',
    {},
    async () => ({
      status: ctx.status(),
      session: ctx.hello()?.session,
      capabilities: ctx.hello()?.capabilities,
      kubejsVersion: ctx.hello()?.kubejsVersion ?? null,
      roots: await ctx.workspace.roots(),
    }),
  );
  tool(
    'kubevs_connect',
    'Connect Minecraft using an explicit private /kvs join code or the saved Connector credentials. No dialogs or workspace window reloads. Never returns credentials.',
    { code: z.string().max(1024).optional() },
    async (args) => {
      await ctx.connect(args.code);
      return ctx.status();
    },
    false,
  );
  tool(
    'kubevs_disconnect',
    'Disconnect the current Minecraft session without closing files or reloading the VS Code window.',
    {},
    async () => {
      await ctx.disconnect();
      return ctx.status();
    },
    false,
  );
  tool(
    'kubevs_connector_health',
    'Read live Connector health and latency without changing connection settings.',
    {},
    async () => {
      const start = Date.now();
      return { health: await request('connector.status'), latencyMs: Date.now() - start };
    },
  );
  tool(
    'kubevs_project_roots',
    'List accessible local KubeJS projects and the current Connector server. No arbitrary filesystem roots are accepted.',
    {},
    () => ctx.workspace.roots(),
  );
  tool(
    'kubevs_list_files',
    'List a directory in the selected KubeJS root. Paginated; use subdirectory paths to walk scripts, assets and data.',
    { root: rootArg, path: z.string().max(1024).default(''), ...page },
    (args) => ctx.workspace.list(args),
  );
  tool(
    'kubevs_read_file',
    'Read a UTF-8 KubeJS file and its content revision. Read before overwriting or deleting.',
    { root: rootArg, path: pathArg },
    (args) => ctx.workspace.read(args),
  );
  tool(
    'kubevs_write_file',
    'Create or edit a UTF-8 KubeJS script, resource or schema. Existing files require the exact revision from read_file. Rejects dirty editor documents and paths outside the project.',
    {
      root: rootArg,
      path: pathArg,
      content: text,
      expectedRevision: revision.nullable().optional(),
    },
    async (args) => {
      const result = await ctx.workspace.write(args);
      await ctx.refresh();
      return result;
    },
    false,
  );
  tool(
    'kubevs_delete_file',
    'Delete one project file using its exact revision. This changes the file, not the running game.',
    { root: rootArg, path: pathArg, expectedRevision: revision },
    async (args) => {
      const result = await ctx.workspace.delete(args);
      await ctx.refresh();
      return result;
    },
    false,
  );
  tool(
    'kubevs_move_file',
    'Move or copy one KubeJS file to a new non-existing path in the same root. Source revision is required.',
    {
      root: rootArg,
      path: pathArg,
      destination: pathArg,
      expectedRevision: revision,
      copy: z.boolean().default(false),
    },
    async (args) => {
      const result = await ctx.workspace.move(args);
      await ctx.refresh();
      return result;
    },
    false,
  );
  tool(
    'kubevs_create_directory',
    'Create a scripts, asset or data directory within a KubeJS root.',
    { root: rootArg, path: pathArg },
    (args) => ctx.workspace.mkdir(args),
    false,
  );
  tool(
    'kubevs_generate_recipe',
    'Preview or save a vanilla or custom mod recipe from recipe JSON. Supports crafting, cooking, Create mechanical crafting, and arbitrary serializers via the same importer as the UI. Existing recipe IDs can be overridden; originals in mod JARs are not changed.',
    { recipeId: id, json: z.record(z.unknown()), ...saveArgs },
    async (args) => {
      const recipe = recipeCode(args.recipeId, args.json);
      const result = await saveCode(
        args,
        recipe.code,
        recipePath(args.recipeId, recipe.recipeType),
      );
      return { result, warnings: recipe.warnings };
    },
    false,
  );
  const stack = z.object({
    item: id,
    count: z.number().int().min(1).max(64).default(1),
    chance: z.number().positive().default(1),
  });
  const fluid = z.object({
    fluid: z.string().min(3).max(300),
    amount: z.number().int().positive(),
  });
  tool(
    'kubevs_generate_mod_recipe',
    'Use the validated Create, Oritech or Farmer’s Delight generator, including 9×9 mechanical crafting and sequenced assembly. Preview by default. Other serializers are supported by generate_recipe.',
    {
      draft: z.object({
        type: z.enum([
          'create:pressing',
          'create:crushing',
          'create:milling',
          'create:mixing',
          'create:compacting',
          'create:cutting',
          'create:deploying',
          'create:mechanical_crafting',
          'create:sequenced_assembly',
          'oritech:assembler',
          'oritech:pulverizer',
          'oritech:grinder',
          'oritech:centrifuge',
          'oritech:foundry',
          'oritech:atomic_forge',
          'farmersdelight:cooking',
          'farmersdelight:cutting',
        ]),
        recipeId: id,
        ingredients: z.array(z.string().max(300)).max(64).default([]),
        fluidInputs: z.array(fluid).max(64).default([]),
        outputs: z.array(stack).min(1).max(64),
        fluidOutputs: z.array(fluid).max(64).default([]),
        processingTime: z.number().int().positive().default(100),
        experience: z.number().nonnegative().default(0),
        heat: z.enum(['none', 'heated', 'superheated']).default('none'),
        loops: z.number().int().positive().default(5),
        transitionalItem: z.string().max(300).default(''),
        tool: z.string().max(300).default('#minecraft:axes'),
        sequence: z
          .array(
            z.object({
              type: z.enum(['create:pressing', 'create:deploying', 'create:cutting']),
              ingredient: z.string().max(300).default(''),
            }),
          )
          .max(64)
          .default([]),
        mechanical: z
          .object({
            pattern: z.array(z.string().max(9)).min(1).max(9),
            key: z.record(z.string().max(300)),
            acceptMirrored: z.boolean(),
          })
          .optional(),
      }),
      ...saveArgs,
    },
    async (args) => {
      if (!isAddonRecipeDraft(args.draft)) throw new Error('Invalid mod recipe draft.');
      const hello = ctx.hello();
      if (
        args.save &&
        hello &&
        !hello.capabilities.integrations.includes(args.draft.type.split(':')[0] ?? '')
      )
        throw new Error('The target mod is not installed on the connected server.');
      return saveCode(
        args,
        generateAddonRecipe(args.draft),
        recipePath(args.draft.recipeId, args.draft.type),
      );
    },
    false,
  );
  tool(
    'kubevs_generate_gregtech_shaped_recipe',
    'Create GTCEu shaped crafting with reusable tool symbols. Maximum 3×3. Lowercase s,h,r,w,f,c,d,m,x,k automatically map to saw,hammer,soft mallet,wrench,file,crowbar,screwdriver,mortar,wire cutter,knife. Other symbols require key entries. addMaterialInfo enables recycling data.',
    {
      recipeId: id,
      pattern: z.array(z.string().min(1).max(3)).min(1).max(3),
      key: z.record(z.string().max(300)),
      output: z.string().min(3).max(300),
      count: z.number().int().min(1).max(64).default(1),
      mirrored: z.boolean().default(true),
      addMaterialInfo: z.boolean().default(false),
      ...saveArgs,
    },
    (args) =>
      saveCode(args, generateGregtechShapedRecipe(args), recipePath(args.recipeId, 'gtceu:shaped')),
    false,
  );
  tool(
    'kubevs_generate_gregtech_recipe',
    'Preview or save a GTCEu Modern 1.21.1 machine recipe using its native KubeJS builder. Read kubevs://gregtech-guide for every advanced operation, argument, unit, and example. machine is a registered recipe type path, e.g. assembler. Fluid amounts are mB; duration is ticks; eut is signed EU/t. No implicit overclocking.',
    {
      machine: z
        .string()
        .regex(/^[a-z0-9_]+$/)
        .max(80),
      recipeId: id,
      itemInputs: z.array(z.string().max(300)).max(64).default([]),
      fluidInputs: z.array(fluid).max(64).default([]),
      itemOutputs: z
        .array(
          z.object({
            item: z.string().min(3).max(300),
            count: z.number().int().positive().default(1),
            chance: z.number().positive().max(1).default(1),
          }),
        )
        .max(64)
        .default([]),
      fluidOutputs: z.array(fluid).max(64).default([]),
      nonConsumableItems: z.array(z.string().max(300)).max(64).default([]),
      nonConsumableFluids: z.array(fluid).max(64).default([]),
      circuit: z.number().int().min(0).max(32).nullable().default(null),
      duration: z.number().int().positive(),
      eut: z
        .number()
        .int()
        .refine((value) => value !== 0, 'EU/t must not be zero')
        .nullable()
        .default(null),
      cleanroom: z.enum(['cleanroom', 'sterile_cleanroom']).nullable().default(null),
      blastFurnaceTemp: z.number().int().positive().nullable().default(null),
      researchWithoutRecipe: z.string().min(1).max(300).nullable().default(null),
      operations: z
        .array(
          z
            .object({
              op: z.enum(gregtechOperationNames),
              item: z.string().optional(),
              fluid: z.string().optional(),
              fraction: z.string().optional(),
              snbt: z.string().optional(),
              state: z.string().optional(),
              amount: z.number().optional(),
              count: z.number().optional(),
              chance: z.number().optional(),
              min: z.number().optional(),
              max: z.number().optional(),
              tick: z.boolean().optional(),
              id: z.string().optional(),
              reverse: z.boolean().optional(),
              value: z.union([z.string(), z.number(), z.boolean()]).optional(),
              key: z.string().optional(),
              kind: z.string().optional(),
              fluidMaterialInfo: z.boolean().optional(),
              ids: z.array(z.string().max(300)).max(32).optional(),
              dataItem: id.optional(),
              eut: z.number().int().optional(),
              amperage: z.number().int().optional(),
              duration: z.number().int().optional(),
              cwu: z.number().int().optional(),
              totalCwu: z.number().int().optional(),
            })
            .strict()
            .refine(validateGregtechOperation, 'Invalid GTCEu operation or parameter'),
        )
        .max(128)
        .default([]),
      posY: z.object({ min: z.number().int(), max: z.number().int() }).nullable().default(null),
      ...saveArgs,
    },
    async (args) => {
      if (args.save && ctx.hello() && !ctx.hello()?.capabilities.integrations.includes('gtceu'))
        throw new Error(
          'GTCEu integration is unavailable. Install GTCEu and update Connector to 1.5.0 or later.',
        );
      const result = await saveCode(
        args,
        generateGregtechRecipe(args),
        recipePath(args.recipeId, 'gtceu:' + args.machine),
      );
      const [namespace, path] = args.recipeId.split(':');
      return {
        ...(result as Record<string, unknown>),
        requestedRecipeId: args.recipeId,
        effectiveRecipeId: `${namespace === 'kubejs' ? 'gtceu' : namespace}:${args.machine}/${path}`,
      };
    },
    false,
  );
  tool(
    'kubevs_generate_content',
    'Preview or create an item or block using the same startup builder as the UI. Startup registrations require a full Minecraft restart, not server reload.',
    {
      kind: z.enum(['item', 'block']),
      id,
      displayName: z.string().min(1).max(120),
      textureItem: z.string().max(300).default(''),
      maxStackSize: z.number().int().min(1).max(64).default(64),
      rarity: z.enum(['common', 'uncommon', 'rare', 'epic']).default('common'),
      glow: z.boolean().default(false),
      tooltip: z.string().max(2000).default(''),
      hardness: z.number().min(0).default(1),
      resistance: z.number().min(0).default(1),
      soundType: z.enum(['stone', 'metal', 'wood', 'glass', 'wool']).default('stone'),
      requiresTool: z.boolean().default(false),
      miningTool: z.enum(['pickaxe', 'axe', 'shovel', 'hoe', 'none']).default('none'),
      ...saveArgs,
    },
    (args) =>
      saveCode(
        args,
        generateContentScript(args),
        `startup_scripts/kubevs/${generatedArtifactStem(args.id, args.kind)}.js`,
        'kubejs',
        true,
      ),
    false,
  );
  tool(
    'kubevs_generate_loot',
    'Preview or save a LootJS rule. draft: {targetKind:table|block|entity,target:id or #tag,condition:{id,kind:and|or|not|chance|tool|killedByPlayer|survivesExplosion|custom,value?,children:[]},actions:[{id,kind:add|remove|replace|experience,...}]}. Add uses item,count,chance; remove uses filter; replace uses filter,replacement,preserveCount; experience uses amount. Conditions nest. Read kubevs://guide for examples.',
    {
      draft: z.object({
        targetKind: z.enum(['table', 'block', 'entity']),
        target: z.string().min(3).max(300),
        condition: conditionSchema,
        actions: z.array(lootActionSchema).min(1).max(100),
      }),
      ...saveArgs,
    },
    async (args) => {
      if (!isLootRuleDraft(args.draft))
        throw new Error('Invalid LootJS draft; use targetKind, target, condition and actions.');
      const code = generateLootRule(args.draft);
      return saveCode(
        args,
        code,
        `server_scripts/kubevs/lootjs/loot_${generatedArtifactStem(args.draft.target.replace(/^#/, ''), 'rule')}.js`,
        'lootjs',
      );
    },
    false,
  );
  tool(
    'kubevs_set_recipe_removed',
    'Add or remove one ID in the same managed removal script used by the UI. Read the script revision before saving changes to an existing list. Does not reload automatically.',
    { recipeId: id, removed: z.boolean(), ...saveArgs },
    async (args) => {
      const path = 'server_scripts/kubevs/zz_kubevs_removed_recipes.js';
      let source = '',
        currentRevision: string | null = null;
      try {
        const current = await ctx.workspace.read({ root: args.root, path });
        source = current.content;
        currentRevision = current.revision;
      } catch (error) {
        if (!isMissingFile(error)) throw error;
      }
      const ids = [
        ...source.matchAll(
          /event\.remove\(\{\s*id:\s*(["'])([a-z0-9_.-]+:[a-z0-9_./-]+)\1\s*\}\)/gu,
        ),
      ].map((m) => m[2] ?? '');
      const next = args.removed
        ? withRemovedRecipe(ids, args.recipeId)
        : withoutRemovedRecipe(ids, args.recipeId);
      return {
        currentRevision,
        removed: next,
        result: await saveCode({ ...args, path }, generateRecipeRemovalScript(next), path),
      };
    },
    false,
  );
  tool(
    'kubevs_replace_recipe',
    'Override a live recipe ID using another live recipe as a template. Saves a managed KubeJS script; keeps the target recipe ID.',
    { targetId: id, sourceId: id, ...saveArgs },
    async (args) => {
      connected();
      const source = await ctx.connector.request<{ id: string; json: unknown }>('recipes.get', {
        id: args.sourceId,
      });
      const replacement = buildRecipeReplacement(args.targetId, source.id, source.json);
      return {
        warnings: replacement.warnings,
        result: await saveCode(
          args,
          replacement.code,
          recipePath(args.targetId, replacement.recipeType),
        ),
      };
    },
    false,
  );
  tool(
    'kubevs_list_recipes',
    'Search live recipe IDs and serializers with pagination. Use get_recipe to read a recipe definition.',
    { query: z.string().max(300).default(''), type: id.optional(), ...page },
    async (args) => {
      connected();
      const snapshot = await ctx.connector.request<{ types: Record<string, string[]> }>(
        'recipes.types',
      );
      const entries = Object.entries(snapshot.types)
        .flatMap(([recipeType, ids]) => ids.map((id) => ({ id, recipeType })))
        .filter(
          (e) =>
            (!args.type || args.type === e.recipeType) &&
            (e.id + ' ' + e.recipeType).toLowerCase().includes(args.query.toLowerCase()),
        )
        .sort((a, b) => a.id.localeCompare(b.id));
      return {
        entries: entries.slice(args.offset, args.offset + args.limit),
        total: entries.length,
        offset: args.offset,
        hasMore: args.offset + args.limit < entries.length,
        source: 'live',
      };
    },
  );
  tool(
    'kubevs_get_recipe',
    'Read the exact live JSON definition of a recipe by namespaced ID.',
    { id },
    (args) => request('recipes.get', args),
  );
  tool(
    'kubevs_list_registries',
    'List available registry IDs, including offline project registries.',
    {},
    () => ctx.catalog.browseChoices(),
  );
  tool(
    'kubevs_search_registry',
    'Search registry names, IDs and tags. Returns up to 60 entries per page and identifies live/offline source.',
    {
      query: z.string().max(300).default(''),
      registry: id.default('minecraft:item'),
      offset: page.offset,
      tagsOnly: z.boolean().default(false),
    },
    (args) => ctx.catalog.browse(args.query, args.registry, args.offset, args.tagsOnly),
  );
  tool(
    'kubevs_tag_members',
    'Read members of a live tag with pagination. No silent empty results on disconnect.',
    { tag: z.string().max(300), registry: id.default('minecraft:item'), ...page },
    (args) => request('registry.tagEntries', { ...args, tag: args.tag.replace(/^#/, '') }),
  );
  tool(
    'kubevs_registry_icon',
    'Read the PNG data URI of one registered item icon, when available.',
    { id },
    (args) => request('registry.icon', args),
  );
  tool(
    'kubevs_list_mods',
    'Read names and versions of installed mods on the connected game/server.',
    {},
    () => request('mods.list'),
  );
  tool(
    'kubevs_logs',
    'Read recent Connector logs for diagnosing script reloads and remote file operations.',
    {},
    () => request('logs.list'),
  );
  tool(
    'kubevs_inspect_held_item',
    'Read the connected player’s held item. Requires a personal /kvs join session and an online player.',
    {},
    () => request('player.inspectHeldItem'),
  );
  tool('kubevs_file_locks', 'Inspect team locks in the connected server workspace.', {}, () =>
    request('workspace.locks.list'),
  );
  tool(
    'kubevs_set_reload_enabled',
    'Admin only, Connector 1.7.0+: enable or disable resource reload by persisting permissions.allowReload. Changes all sessions immediately. Requires explicit user authorization to change this server setting. Does not restart Minecraft or reload resources; call kubevs_reload afterward.',
    { enabled: z.boolean() },
    async (args) => {
      if (connected().session?.role !== 'admin')
        throw new Error('Only a Connector administrator can change reload policy.');
      const result = await request('reload.policy.set', { enabled: args.enabled });
      await ctx.refresh();
      return result;
    },
    false,
  );
  tool(
    'kubevs_reload',
    'Reload server resources to apply recipes and LootJS scripts. Never registers new items/blocks; startup_scripts require restart. Requires Connector reload capability and operator rights.',
    {},
    async () => {
      if (!connected().capabilities.reload)
        throw new Error('Server reload is disabled or not permitted for this session.');
      return request('reload.server');
    },
    false,
  );
  tool(
    'kubevs_diagnostics',
    'Analyze script text or an existing project file using the same KubeJS lexical diagnostics as VS Code. Does not execute scripts.',
    {
      root: rootArg,
      path: pathArg.optional(),
      code: text.optional(),
      kind: z
        .enum(['server_scripts', 'client_scripts', 'startup_scripts'])
        .default('server_scripts'),
    },
    async (args) => {
      const code =
        args.code ??
        (args.path
          ? (await ctx.workspace.read({ root: args.root, path: args.path })).content
          : undefined);
      if (code === undefined) throw new Error('Supply code or path.');
      return analyzeKubeJs(
        code,
        args.path ? (classifyScriptPath(args.path) ?? args.kind) : args.kind,
      );
    },
  );
  tool(
    'kubevs_validate_project',
    'Analyze KubeJS scripts in a root without opening editors. Paginated file scan; returns meaningful diagnostics and counts.',
    { root: rootArg, limit: z.number().int().min(1).max(200).default(100) },
    async (args) => {
      const files: string[] = [];
      const queue = ['server_scripts', 'client_scripts', 'startup_scripts'];
      let truncated = false;
      while (queue.length && files.length < args.limit) {
        const path = queue.shift();
        if (path === undefined) break;
        let offset = 0;
        for (;;) {
          const batch = await ctx.workspace
            .list({ root: args.root, path, offset, limit: 200 })
            .catch((error) => {
              if (isMissingFile(error)) return undefined;
              throw error;
            });
          if (!batch) break;
          for (const entry of batch.entries) {
            if (entry.type === 'directory') {
              if (queue.length < 1000) queue.push(entry.path);
              else truncated = true;
            } else if (/\.(?:m?js|ts)$/.test(entry.path)) {
              files.push(entry.path);
              if (files.length >= args.limit) break;
            }
          }
          if (!batch.hasMore || files.length >= args.limit) break;
          offset += batch.entries.length;
        }
      }
      const results = [];
      for (const path of files) {
        const file = await ctx.workspace.read({ root: args.root, path });
        results.push({
          path,
          issues: analyzeKubeJs(file.content, classifyScriptPath(path) ?? 'server_scripts'),
        });
      }
      return {
        checked: results.length,
        truncated: truncated || queue.length > 0 || files.length >= args.limit,
        results,
      };
    },
  );
  tool(
    'kubevs_craft_graph',
    'Build a production chain and resource totals from live recipes. Supports recipe selection per output and bounded depth. No GUI required.',
    {
      item: id,
      amount: z.number().positive().max(1000000).default(1),
      maxDepth: z.number().int().min(1).max(12).default(6),
      selections: z.record(z.string()).default({}),
    },
    async (args) => {
      connected();
      const entries: RecipeSnapshotEntry[] = [];
      let offset = 0;
      for (;;) {
        const batch = await ctx.connector.request<PagedRecipeSnapshots>('recipes.snapshot', {
          offset,
          limit: 500,
        });
        entries.push(...batch.entries);
        if (entries.length > 25000)
          throw new Error('Too many recipes for one graph request (25000 maximum).');
        if (!batch.hasMore) break;
        const next = batch.offset + batch.entries.length;
        if (next <= offset) throw new Error('Connector returned a non-advancing recipe page.');
        offset = next;
      }
      const recipes = entries.map(normalizeRecipe).filter((r): r is CraftRecipe => r !== undefined);
      const tree = buildCraftTree(
        recipes,
        args.item,
        args.amount,
        args.selections,
        args.maxDepth,
        1000,
      );
      return { tree, totals: calculateCraftTotals(tree), source: 'live' };
    },
  );
  tool(
    'kubevs_recipe_schema',
    'Validate a custom recipe schema, preview its JSON or save a recipe from schema values. Schemas use the same parser as the UI. To store the schema itself use write_file in .kubevs/recipe-schemas.',
    {
      schema: z.record(z.unknown()),
      values: z.record(z.unknown()).default({}),
      recipeId: id,
      ...saveArgs,
    },
    async (args) => {
      const schema = parseRecipeSchema(args.schema);
      const raw = buildRecipeFromSchema(schema, { recipeId: args.recipeId, values: args.values });
      const recipe = recipeCode(args.recipeId, raw);
      return saveCode(args, recipe.code, recipePath(args.recipeId, recipe.recipeType));
    },
    false,
  );
  tool(
    'kubevs_list_recipe_schemas',
    'Read installed custom recipe schema definitions and parser errors, including the built-in raw JSON schema.',
    {},
    () => loadRecipeSchemas(),
  );
  tool(
    'kubevs_loot_presets',
    'Read validated LootJS starter rules for chests, fishing, leaves, stone and mobs.',
    {},
    async () => LOOT_RULE_PRESETS,
  );
  return tools;
}

export function createMcpResources(ctx: McpToolsContext): readonly KubeVsMcpResource[] {
  return [
    {
      uri: 'kubevs://status',
      name: 'KubeVS status',
      description: 'Current project and Minecraft capabilities; no credentials.',
      read: async () => ({ status: ctx.status(), roots: await ctx.workspace.roots() }),
    },
    {
      uri: 'kubevs://guide',
      name: 'KubeVS automation guide',
      description: 'Workflow, dependencies, examples and safe revision-based writes.',
      read: async () => ({
        workflow: [
          'Read status and project_roots.',
          'Search registries and recipes for real IDs.',
          'Preview a recipe, loot rule or startup item/block.',
          'Set save:true to create a file. To overwrite, read_file first and pass its revision.',
          'Reload server resources explicitly to apply recipes/loot when allowed. With explicit user authorization, an admin can enable reload using kubevs_set_reload_enabled (Connector 1.7.0+). Restart Minecraft for startup registrations.',
        ],
        dependencies: {
          recipes: 'KubeJS',
          loot: 'KubeJS + LootJS',
          itemsAndBlocks: 'KubeJS; full restart required',
        },
        editing:
          'read_file -> edit content -> write_file with expectedRevision. No UI dialog, focus change or arbitrary command execution.',
        recipeExample: {
          recipeId: 'kubevs:example',
          json: {
            type: 'minecraft:crafting_shapeless',
            ingredients: [{ item: 'minecraft:stone' }],
            result: { id: 'minecraft:diamond', count: 1 },
          },
        },
        lootExample: {
          targetKind: 'block',
          target: 'minecraft:stone',
          condition: { id: 'root', kind: 'chance', value: 1, children: [] },
          actions: [{ id: 'drop', kind: 'add', item: 'minecraft:emerald', count: 1, chance: 1 }],
        },
        limits:
          'Local projects must be trusted. HTTP bearer authentication is required. Server operations retain Connector permissions. File paths stay within KubeJS content roots; dirty editor buffers are protected.',
      }),
    },
    {
      uri: 'kubevs://gregtech-guide',
      name: 'GTCEu 1.21 recipe builder guide',
      description: 'Advanced operations and argument units for kubevs_generate_gregtech_recipe.',
      read: async () => ({
        source:
          'GregTechCEu/GregTech-Modern 1.21, commit 36a6b38c580e54445e055e3ca05eecf675f2cb96, GTRecipeSchema.java',
        controls: gregtechOperationControls,
        operationFormat:
          'operations is an ordered array of objects with op plus the listed fields. Unknown fields and operations are rejected. IDs use namespace:path unless marked arbitrary string.',
        groups: {
          io: {
            operations: [
              'itemInput',
              'itemOutput: {item,count?,chance?,fraction?,tick?}',
              'fluidInput',
              'fluidOutput: {fluid,amount,chance?,fraction?,tick?}',
            ],
            units:
              'count is items; amount is mB; chance is 0–1, rounded to 1/10000. Input chance 0 means a reusable catalyst. fraction is output-only numerator/denominator with denominator ≤10000. tick switches the call to per-tick IO and resets it afterward.',
            example: {
              op: 'fluidOutput',
              fluid: 'minecraft:water',
              amount: 250,
              chance: 0.25,
              tick: true,
            },
          },
          ranged: {
            operations: [
              'itemInputRanged',
              'itemOutputRanged: {item,min,max,tick?}',
              'fluidInputRanged',
              'fluidOutputRanged: {fluid,min,max,tick?}',
            ],
            units:
              'min/max are positive item counts or mB. Item IDs may be #tags. The range is inclusive.',
          },
          energy: {
            operations: [
              'EUt',
              'inputEU',
              'outputEU: {value,amount?}',
              'CWUt',
              'inputCWU',
              'outputCWU',
              'totalCWU: {value}',
            ],
            units:
              'EU voltage is signed for EUt, amount is amperage. CWU is integer; negative CWUt outputs CWU. totalCWU changes recipe duration and should be used only when intended.',
          },
          data: {
            operations: [
              'addDataString',
              'addDataNumber',
              'addDataBool: {key,value}',
              'explosivesAmount',
              'solderMultiplier',
              'fusionStartEU: {value}',
              'explosivesType: {item,count?}',
              'disableDistilleryRecipes',
              'researchScan',
              'durationIsTotalCWU',
              'hideDuration: {value:boolean}',
            ],
            units:
              'Temperature and item counts are Java int; fusionStartEU is long limited to safe JavaScript integer precision.',
          },
          conditions: {
            operations: [
              'rain',
              'thunder: {value:0..1,reverse?}',
              'posY: {min,max,reverse?}',
              'daytime: {value:boolean}',
              'nighttime',
              'dimension',
              'biome',
              'biomeTag',
              'environmentalHazard: {id,reverse?}',
              'adjacentFluids',
              'adjacentFluidTag',
              'adjacentBlocks',
              'adjacentBlockTag: {ids:[namespace:path],reverse?}',
              'heraclesQuest',
              'ftbQuest: {id,reverse?}',
            ],
            caveat:
              'Quest conditions require their integration mods; FTB quest IDs are nonzero hexadecimal codes of up to 16 digits. Dimension/biome/adjacency use fixed Java class factories; validate with a running 1.21 game before deployment.',
          },
          research: {
            operations: [
              'researchWithoutRecipe: {id,dataItem?}',
              'scannerResearch: {item? or fluid+amount,id?,dataItem?,duration?,eut?,amperage?}',
              'stationResearch: {item? or fluid+amount,id?,dataItem?,cwu,totalCwu,eut?,amperage?}',
            ],
            caveat:
              'dataItem must actually carry gtceu:data_item; research requires GTCEu research enabled. Station totalCwu must be ≥ cwu.',
          },
          metadata: {
            operations: [
              'category: {id}',
              'chanceLogic: {kind:itemInput|fluidInput|itemOutput|fluidOutput|tickInput|tickOutput,id,key?}',
              'addMaterialInfo: {value:boolean,fluidMaterialInfo?}',
              'removePreviousMaterialInfo',
            ],
            caveat:
              'Chance logic ID and optional tick capability key must exist in the GT registries.',
          },
        },
        topLevel:
          'cleanroom is cleanroom or sterile_cleanroom; blastFurnaceTemp is kelvin; researchWithoutRecipe is a research ID; posY is min/max; circuit is 0–32. All are optional except machine, recipeId, duration and IO.',
        boundary:
          'Arbitrary addon Java capabilities or custom RecipeCondition objects need native KubeJS scripting. Existing GT recipe JSON can be preserved with generic recipe read/write tools.',
      }),
    },
  ];
}
