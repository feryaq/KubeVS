import fs from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ConnectorClient } = require('../dist/connectorClient.cjs');

const tokenFile = process.env.KUBEVS_TOKEN_FILE;
if (!tokenFile) throw new Error('KUBEVS_TOKEN_FILE is required');
const token = (await fs.readFile(tokenFile, 'utf8')).trim();
const client = new ConnectorClient();
const connectorUrl = process.env.KUBEVS_URL || 'ws://127.0.0.1:32145';

try {
  const hello = await client.connect(connectorUrl, token);
  const [registries, items, tags, recipes, recipeTypes, mods, reload, logs] = await Promise.all([
    client.request('registry.list'),
    client.request('registry.items', { limit: 2 }),
    client.request('registry.tags', { registry: 'minecraft:item', limit: 2 }),
    client.request('recipes.list', { limit: 2 }),
    client.request('recipes.types'),
    client.request('mods.list'),
    client.request('reload.server'),
    client.request('logs.list'),
  ]);
  const firstRecipe = recipes.entries[0];
  if (!firstRecipe) throw new Error('Minecraft returned no recipes');
  const recipe = await client.request('recipes.get', { id: firstRecipe });
  const firstTag = tags.entries[0];
  const tagValues = firstTag
    ? await client.request('registry.tagValues', {
        registry: 'minecraft:item',
        tag: firstTag,
        limit: 2,
      })
    : { total: 0 };
  const itemEntries = await client.request('registry.entries', {
    registry: 'minecraft:item',
    limit: 2,
  });
  const debugItems = await client.request('registry.items', {
    query: 'kubevs:debug_item',
    limit: 10,
  });
  const debugBlocks = await client.request('registry.search', {
    query: 'kubevs:debug_block',
    limit: 10,
  });
  const debugRecipe = await client.request('recipes.get', { id: 'kubevs:debug_block' });
  if (!debugItems.entries.includes('kubevs:debug_item')) {
    throw new Error('Debug item is missing from the live item registry');
  }
  if (
    !debugBlocks.entries.some(
      (entry) => entry.id === 'kubevs:debug_block' && entry.registry === 'minecraft:block',
    )
  ) {
    throw new Error('Debug block is missing from the live block registry');
  }
  process.stdout.write(
    `${JSON.stringify({
      minecraft: hello.minecraftVersion,
      connector: hello.connectorVersion,
      workspace: hello.workspace,
      capabilities: hello.capabilities,
      registries: registries.total,
      items: items.total,
      genericItems: itemEntries.total,
      tags: tags.total,
      firstTagValues: tagValues.total,
      recipes: recipes.total,
      recipeTypes: Object.keys(recipeTypes.types).length,
      recipeJsonId: recipe.id,
      debugRecipe: debugRecipe.id,
      debugItem: debugItems.entries.find((entry) => entry === 'kubevs:debug_item'),
      debugBlock: debugBlocks.entries.find((entry) => entry.registry === 'minecraft:block')?.id,
      mods: mods.total,
      reloaded: reload.reloaded,
      logEntries: logs.entries.length,
    })}\n`,
  );
} finally {
  client.disconnect();
}
