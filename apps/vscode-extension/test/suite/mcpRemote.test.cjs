const assert = require('node:assert/strict');
const vscode = require('vscode');
const fs = require('node:fs/promises');
const path = require('node:path');

suite('KubeVS MCP remote Connector', () => {
  test('uses live tools and revision-safe server writes without opening UI', async function () {
    this.timeout(30_000);
    const extension = vscode.extensions.getExtension('kubevs.kubevs-extension');
    assert.ok(extension);
    await extension.activate();
    await vscode.commands.executeCommand('kubevs.disconnect');
    const [{ Client }, { StreamableHTTPClientTransport }] = await Promise.all([
      import('@modelcontextprotocol/sdk/client/index.js'),
      import('@modelcontextprotocol/sdk/client/streamableHttp.js'),
    ]);
    const { url, token } = await vscode.commands.executeCommand('kubevs.__test.mcpStart');
    const client = new Client({ name: 'KubeVS remote acceptance', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    const connectionCode = (connectorToken) =>
      `kubevs://127.0.0.1:${process.env.KUBEVS_TEST_CONNECTOR_PORT}?token=${connectorToken}`;
    const normalCode = connectionCode(process.env.KUBEVS_TEST_CONNECTOR_TOKEN);
    const created = new Set();
    const tabsBefore = vscode.window.tabGroups.all.reduce(
      (sum, group) => sum + group.tabs.length,
      0,
    );
    const foldersBefore = (vscode.workspace.workspaceFolders ?? []).map((folder) =>
      folder.uri.toString(),
    );
    let primaryError;
    let connected = false;
    const call = async (name, args = {}) => {
      const reply = await client.callTool({ name, arguments: args });
      assert.equal(reply.isError, undefined, `${name}: ${JSON.stringify(reply.content)}`);
      assert.ok(
        reply.structuredContent && 'result' in reply.structuredContent,
        `${name} has no structured result`,
      );
      return reply.structuredContent.result;
    };
    const errorResult = async (name, args, pattern) => {
      const reply = await client.callTool({ name, arguments: args });
      assert.equal(reply.isError, true, `${name} unexpectedly succeeded`);
      assert.match(JSON.stringify(reply.content), pattern);
    };
    const saved = (result) => {
      assert.equal(result.saved, true, JSON.stringify(result));
      assert.equal(result.root, 'server');
      assert.match(result.path, /\.js$/);
      created.add(result.path);
      return result;
    };
    const baselineUi = () => {
      assert.equal(
        vscode.window.tabGroups.all.reduce((sum, group) => sum + group.tabs.length, 0),
        tabsBefore,
      );
      assert.deepEqual(
        (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.toString()),
        foldersBefore,
      );
    };
    const id = `mcp_remote_${Date.now()}`;
    try {
      await client.connect(transport);
      const names = (await client.listTools()).tools.map((tool) => tool.name);
      for (const name of [
        'kubevs_connect',
        'kubevs_disconnect',
        'kubevs_list_recipes',
        'kubevs_get_recipe',
        'kubevs_craft_graph',
        'kubevs_list_recipe_schemas',
        'kubevs_recipe_schema',
        'kubevs_reload',
      ])
        assert.ok(names.includes(name), `${name} absent`);
      const connection = await call('kubevs_connect', { code: normalCode });
      connected = true;
      assert.equal(connection.state, 'connected');
      baselineUi();
      const roots = await call('kubevs_project_roots');
      assert.equal(roots[0].id, 'server');
      assert.equal(roots[0].remote, true);
      const status = await call('kubevs_status');
      assert.equal(status.kubejsVersion, 'test');
      assert.ok(!JSON.stringify(status).includes(process.env.KUBEVS_TEST_CONNECTOR_TOKEN));
      const listing = await call('kubevs_list_files', { root: 'server', path: '' });
      assert.ok(listing.entries.some((entry) => entry.path === 'server_scripts'));

      const recipes = await call('kubevs_list_recipes', { query: 'test_' });
      assert.deepEqual(
        recipes.entries.map((entry) => entry.id),
        ['create:test_pressing', 'minecraft:test_sticks'],
      );
      const source = await call('kubevs_get_recipe', { id: 'minecraft:test_sticks' });
      assert.equal(source.json.result.id, 'minecraft:stick');
      await errorResult('kubevs_set_reload_enabled', { enabled: true }, /administrator/i);
      const graph = await call('kubevs_craft_graph', {
        item: 'minecraft:stick',
        amount: 8,
        format: 'tree',
      });
      assert.equal(graph.tree.recipeId, 'minecraft:test_sticks');
      assert.equal(graph.totals.items['minecraft:oak_planks'], 2);
      assert.equal(graph.coverage.catalogRecipes, 36028);
      const summary = await call('kubevs_craft_graph', {
        item: 'pack:item_36025',
        format: 'resources',
      });
      assert.equal(summary.recipeId, 'pack:catalog_36025');
      assert.equal(summary.tree, undefined);
      assert.equal(summary.coverage.catalogComplete, true);
      assert.equal(summary.resources.entries[0].id, 'minecraft:oak_planks');
      const fields = await call('kubevs_get_recipe', {
        id: 'minecraft:test_sticks',
        paths: ['/ingredients'],
      });
      assert.deepEqual(fields.fields['/ingredients'], source.json.ingredients);
      assert.equal(fields.json, undefined);
      const unchangedRecipe = await call('kubevs_get_recipe', {
        id: 'minecraft:test_sticks',
        paths: ['/ingredients'],
        ifRevision: fields.revision,
      });
      assert.deepEqual(unchangedRecipe, {
        id: 'minecraft:test_sticks',
        revision: fields.revision,
        unchanged: true,
      });
      const otherProjection = await call('kubevs_get_recipe', {
        id: 'minecraft:test_sticks',
        paths: ['/result'],
        ifRevision: fields.revision,
      });
      assert.deepEqual(otherProjection.fields['/result'], source.json.result);
      assert.equal(otherProjection.unchanged, undefined);
      const compactGraph = await call('kubevs_craft_graph', { item: 'minecraft:stick', amount: 8 });
      assert.equal(compactGraph.graph.nodes.length, 2);
      assert.equal(compactGraph.totals.items['minecraft:oak_planks'], 2);
      assert.ok(JSON.stringify(compactGraph.graph).length < JSON.stringify(graph.tree).length);
      const unchangedGraph = await call('kubevs_craft_graph', {
        item: 'minecraft:stick',
        amount: 8,
        ifRevision: compactGraph.revision,
      });
      assert.equal(unchangedGraph.unchanged, true);
      assert.equal(unchangedGraph.graph, undefined);
      const verify = await call('kubevs_verify_recipe', {
        id: 'minecraft:test_sticks',
        checks: [{ path: '/ingredients', expected: source.json.ingredients }],
      });
      assert.equal(verify.matches, true);
      const mismatch = await call('kubevs_verify_recipe', {
        id: 'minecraft:test_sticks',
        checks: [{ path: '/ingredients', expected: [{ item: 'minecraft:iron_ingot' }] }],
      });
      assert.deepEqual(mismatch.failures, ['/ingredients']);
      const patchArgs = {
        recipeId: 'minecraft:test_sticks',
        edits: [
          {
            path: '/ingredients/0',
            expected: { item: 'minecraft:oak_planks' },
            value: { item: 'gtceu:wrought_iron_ingot' },
          },
        ],
      };
      const patch = await call('kubevs_patch_recipe', patchArgs);
      assert.match(patch.result.code, /event.custom/);
      assert.match(patch.result.code, /gtceu:wrought_iron_ingot/);
      await errorResult(
        'kubevs_patch_recipe',
        { ...patchArgs, root: 'server', save: true, sourceRevision: 'stale' },
        /recipe revision conflict/i,
      );
      saved(
        (
          await call('kubevs_patch_recipe', {
            ...patchArgs,
            root: 'server',
            save: true,
            sourceRevision: patch.sourceRevision,
          })
        ).result,
      );
      const registries = await call('kubevs_list_registries');
      assert.ok(registries.some((entry) => entry.id === 'minecraft:item'));
      const search = await call('kubevs_search_registry', {
        query: 'iron',
        registry: 'minecraft:item',
      });
      assert.ok(search.entries.some((entry) => entry.id === 'minecraft:iron_ingot'));
      const tags = await call('kubevs_tag_members', { tag: '#minecraft:ingots/iron' });
      assert.deepEqual(tags.entries, ['minecraft:iron_ingot']);
      const icon = await call('kubevs_registry_icon', { id: 'minecraft:iron_ingot' });
      assert.equal(icon.dataUri, null);
      assert.ok((await call('kubevs_list_mods')).entries.some((entry) => entry.id === 'create'));
      assert.match((await call('kubevs_logs')).entries[0].message, /Fixture Connector/);
      assert.equal((await call('kubevs_inspect_held_item')).id, 'minecraft:iron_ingot');
      assert.deepEqual((await call('kubevs_file_locks')).entries, []);
      assert.equal((await call('kubevs_connector_health')).health.kubejsVersion, 'test');
      await errorResult('kubevs_reload', {}, /reload.*disabled|not permitted/i);

      const catalogSummary = await call('kubevs_list_recipe_schemas', {
        includeDefinitions: false,
      });
      assert.ok(catalogSummary.entries.some((entry) => entry.id === 'kubevs:raw_custom'));
      assert.equal(catalogSummary.entries[0].schema, undefined);
      const schemaCatalog = await call('kubevs_list_recipe_schemas', {
        schemaId: 'kubevs:raw_custom',
      });
      const unchangedSchemas = await call('kubevs_list_recipe_schemas', {
        schemaId: 'kubevs:raw_custom',
        ifRevision: schemaCatalog.revision,
      });
      assert.equal(unchangedSchemas.unchanged, true);
      if (process.env.KUBEVS_MCP_EFFICIENCY_REPORT) {
        const reportPath = process.env.KUBEVS_MCP_EFFICIENCY_REPORT;
        const bytes = (value) => Buffer.byteLength(JSON.stringify(value), 'utf8');
        await fs.mkdir(path.dirname(reportPath), { recursive: true });
        await fs.writeFile(
          reportPath,
          JSON.stringify(
            {
              catalogRecipes: graph.coverage.catalogRecipes,
              source: 'isolated Code + real MCP SDK client + fixture Connector',
              nestedTreeBytes: bytes(graph.tree),
              losslessGraphBytes: bytes(compactGraph.graph),
              fullGraphReplyBytes: bytes(compactGraph),
              unchangedGraphReplyBytes: bytes(unchangedGraph),
              schemaReplyBytes: bytes(schemaCatalog),
              unchangedSchemaReplyBytes: bytes(unchangedSchemas),
              losslessRoundTrip: 'covered by craftGraphCore.test.mjs',
              tokenUsageMeasured: false,
            },
            null,
            2,
          ) + '\n',
        );
      }
      const raw = schemaCatalog.entries.find(
        (entry) => entry.schema.id === 'kubevs:raw_custom',
      )?.schema;
      assert.ok(raw, 'built-in raw schema absent');
      const preview = await call('kubevs_recipe_schema', {
        schema: raw,
        recipeId: `kubevs:${id}_schema`,
        values: { type: 'minecraft:crafting_shapeless', $: source.json },
      });
      assert.equal(preview.saved, false);
      assert.match(preview.code, /event\.shapeless/);
      assert.match(preview.code, /minecraft:oak_planks/);

      const vanilla = await call('kubevs_generate_recipe', {
        root: 'server',
        recipeId: `kubevs:${id}_vanilla`,
        json: source.json,
        save: true,
      });
      const vanillaFile = saved(vanilla.result);
      assert.equal(
        vanillaFile.content,
        undefined,
        'saving must not echo the whole script by default',
      );
      const first = await call('kubevs_read_file', { root: 'server', path: vanillaFile.path });
      assert.match(first.revision, /^[a-f0-9]{64}$/);
      const updated = await call('kubevs_write_file', {
        root: 'server',
        path: vanillaFile.path,
        content: `${first.content}\n// revised\n`,
        expectedRevision: first.revision,
      });
      assert.notEqual(updated.revision, first.revision);
      await errorResult(
        'kubevs_write_file',
        {
          root: 'server',
          path: vanillaFile.path,
          content: 'stale',
          expectedRevision: first.revision,
        },
        /revision/i,
      );
      const copiedPath = `server_scripts/kubevs/crafts/vanilla/${id}_copy.js`;
      await call('kubevs_move_file', {
        root: 'server',
        path: vanillaFile.path,
        destination: copiedPath,
        expectedRevision: updated.revision,
        copy: true,
      });
      created.add(copiedPath);
      assert.equal(
        (await call('kubevs_read_file', { root: 'server', path: copiedPath })).content,
        `${first.content}\n// revised\n`,
      );

      saved(
        await call('kubevs_generate_mod_recipe', {
          root: 'server',
          save: true,
          draft: {
            type: 'create:pressing',
            recipeId: `kubevs:${id}_pressing`,
            ingredients: ['minecraft:iron_ingot'],
            outputs: [{ item: 'create:iron_sheet', count: 1, chance: 1 }],
          },
        }),
      );
      saved(
        await call('kubevs_generate_loot', {
          root: 'server',
          save: true,
          draft: {
            targetKind: 'block',
            target: `minecraft:${id}`,
            condition: { id: 'root', kind: 'chance', value: 1, children: [] },
            actions: [
              { id: 'drop', kind: 'add', item: 'minecraft:iron_ingot', count: 1, chance: 1 },
            ],
          },
        }),
      );
      saved(
        await call('kubevs_generate_content', {
          root: 'server',
          save: true,
          kind: 'block',
          id: `kubevs:${id}_block`,
          displayName: 'Remote MCP Block',
        }),
      );
      const removal = await call('kubevs_set_recipe_removed', {
        root: 'server',
        recipeId: `kubevs:${id}_removed`,
        removed: true,
        save: true,
      });
      const removalFile = saved(removal.result);
      assert.ok(removal.removed.includes(`kubevs:${id}_removed`));
      const removalRevision = (
        await call('kubevs_read_file', { root: 'server', path: removalFile.path })
      ).revision;
      const restored = await call('kubevs_set_recipe_removed', {
        root: 'server',
        recipeId: `kubevs:${id}_removed`,
        removed: false,
        save: true,
        expectedRevision: removalRevision,
      });
      assert.ok(!restored.removed.includes(`kubevs:${id}_removed`));
      saved(
        await call('kubevs_replace_recipe', {
          root: 'server',
          targetId: `kubevs:${id}_replacement`,
          sourceId: 'minecraft:test_sticks',
          save: true,
        }).then((result) => result.result),
      );
      baselineUi();

      await call('kubevs_connect', {
        code: connectionCode(process.env.KUBEVS_TEST_MISSING_KUBEJS_TOKEN),
      });
      assert.equal((await call('kubevs_status')).kubejsVersion, null);
      await errorResult('kubevs_reload', {}, /disabled|permitted/i);
      assert.equal((await call('kubevs_set_reload_enabled', { enabled: true })).enabled, true);
      assert.equal((await call('kubevs_reload')).reloaded, true);
      assert.equal((await call('kubevs_set_reload_enabled', { enabled: false })).enabled, false);
      await errorResult('kubevs_reload', {}, /disabled|permitted/i);
      baselineUi();

      const missingPreview = await call('kubevs_generate_recipe', {
        root: 'server',
        recipeId: `kubevs:${id}_missing`,
        json: source.json,
      });
      assert.equal(missingPreview.result.saved, false);
      await errorResult(
        'kubevs_generate_recipe',
        {
          root: 'server',
          recipeId: `kubevs:${id}_missing`,
          json: source.json,
          save: true,
        },
        /Install KubeJS/,
      );
      baselineUi();
      await call('kubevs_connect', { code: normalCode });
    } catch (error) {
      primaryError = error;
    } finally {
      const cleanupErrors = [];
      if (connected) {
        try {
          await call('kubevs_connect', { code: normalCode });
        } catch (error) {
          cleanupErrors.push(`reconnect: ${error.message}`);
        }
      }
      for (const path of created) {
        try {
          const current = await call('kubevs_read_file', { root: 'server', path });
          const deleted = await call('kubevs_delete_file', {
            root: 'server',
            path,
            expectedRevision: current.revision,
          });
          assert.equal(deleted.deleted, true);
        } catch (error) {
          cleanupErrors.push(`${path}: ${error.message}`);
        }
      }
      if (connected) {
        try {
          await call('kubevs_disconnect');
        } catch (error) {
          cleanupErrors.push(`disconnect: ${error.message}`);
        }
      }
      try {
        baselineUi();
      } catch (error) {
        cleanupErrors.push(`UI: ${error.message}`);
      }
      try {
        await transport.close();
      } catch (error) {
        cleanupErrors.push(`client close: ${error.message}`);
      }
      try {
        await vscode.commands.executeCommand('kubevs.__test.mcpStop');
      } catch (error) {
        cleanupErrors.push(`MCP stop: ${error.message}`);
      }
      try {
        await assert.rejects(fetch(url, { headers: { Authorization: `Bearer ${token}` } }));
      } catch (error) {
        cleanupErrors.push(`endpoint still available: ${error.message}`);
      }
      if (cleanupErrors.length)
        throw new Error(`Remote MCP cleanup failed: ${cleanupErrors.join('; ')}`, {
          cause: primaryError,
        });
    }
    if (primaryError) throw primaryError;
  });
});
