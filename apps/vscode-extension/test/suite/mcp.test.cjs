const assert = require('node:assert/strict');
const vscode = require('vscode');

suite('KubeVS MCP in installed Code', () => {
  test('serves real SDK clients and safely edits an offline KubeJS project', async () => {
    const extension = vscode.extensions.getExtension('kubevs.kubevs-extension');
    assert.ok(extension);
    await extension.activate();
    await vscode.commands.executeCommand('kubevs.disconnect');

    const [{ Client }, { StreamableHTTPClientTransport }] = await Promise.all([
      import('@modelcontextprotocol/sdk/client/index.js'),
      import('@modelcontextprotocol/sdk/client/streamableHttp.js'),
    ]);
    const { url, token } = await vscode.commands.executeCommand('kubevs.__test.mcpStart');
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    assert.ok(token);
    const client = new Client({ name: 'KubeVS Code acceptance', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    const created = new Map();
    const createdDirectories = [];
    const call = async (name, args = {}) => {
      const reply = await client.callTool({ name, arguments: args });
      assert.equal(reply.isError, undefined, `${name}: ${JSON.stringify(reply.content)}`);
      assert.ok(
        reply.structuredContent && 'result' in reply.structuredContent,
        `${name} omitted structured result`,
      );
      return reply.structuredContent.result;
    };
    const expectToolError = async (name, args, match) => {
      const reply = await client.callTool({ name, arguments: args });
      assert.equal(reply.isError, true, `${name} unexpectedly succeeded`);
      assert.match(JSON.stringify(reply.content), match);
    };
    const remember = (result) => {
      assert.equal(result.saved, true);
      assert.match(result.path, /\.js$/);
      created.set(result.path, result.root);
      return result;
    };
    const testId = `mcp_test_${Date.now()}`;
    let root;
    let primaryError;
    const tabsBefore = vscode.window.tabGroups.all.reduce(
      (count, group) => count + group.tabs.length,
      0,
    );
    try {
      await client.connect(transport);
      assert.equal((await fetch(url)).status, 401);
      assert.equal(
        (await fetch(url, { headers: { Authorization: `Bearer ${token}` } })).status,
        405,
      );
      const names = (await client.listTools()).tools.map((tool) => tool.name);
      for (const name of [
        'kubevs_status',
        'kubevs_project_roots',
        'kubevs_list_files',
        'kubevs_read_file',
        'kubevs_write_file',
        'kubevs_delete_file',
        'kubevs_generate_recipe',
        'kubevs_generate_mod_recipe',
        'kubevs_generate_gregtech_recipe',
        'kubevs_generate_gregtech_shaped_recipe',
        'kubevs_generate_loot',
        'kubevs_generate_content',
        'kubevs_diagnostics',
      ])
        assert.ok(names.includes(name), `${name} absent`);
      const resources = (await client.listResources()).resources;
      assert.ok(resources.some((resource) => resource.uri === 'kubevs://status'));
      assert.ok(resources.some((resource) => resource.uri === 'kubevs://guide'));
      const gtGuide = JSON.parse(
        (await client.readResource({ uri: 'kubevs://gregtech-guide' })).contents[0].text,
      );
      assert.ok(gtGuide.controls.length >= 50);
      for (const control of gtGuide.controls) {
        await call('kubevs_generate_gregtech_recipe', {
          machine: 'assembler',
          recipeId: 'kubevs:advanced_preview',
          duration: 100,
          itemInputs: ['minecraft:stone'],
          itemOutputs: [{ item: 'minecraft:diamond' }],
          operations: [control.example],
        });
      }
      const shapedPreview = await call('kubevs_generate_gregtech_shaped_recipe', {
        recipeId: 'kubevs:tool_preview',
        pattern: ['hA', ' A'],
        key: { A: '#c:ingots/iron' },
        output: 'minecraft:iron_nugget',
        addMaterialInfo: true,
      });
      assert.match(JSON.stringify(shapedPreview), /gtceu.shaped/);
      const status = await call('kubevs_status');
      assert.ok(Array.isArray(status.roots));
      assert.ok(!JSON.stringify(status).includes(token), 'status exposed MCP token');
      const statusResource = await client.readResource({ uri: 'kubevs://status' });
      assert.ok(!JSON.stringify(statusResource).includes(token), 'resource exposed MCP token');
      const roots = await call('kubevs_project_roots');
      root = roots.find((item) => !item.remote && item.id.startsWith('local:'))?.id;
      assert.ok(root, `no local KubeJS root: ${JSON.stringify(roots)}`);
      const top = await call('kubevs_list_files', { root, path: '' });
      assert.ok(top.entries.some((entry) => entry.path === 'server_scripts'));
      if (!top.entries.some((entry) => entry.path === 'startup_scripts')) {
        await call('kubevs_create_directory', { root, path: 'startup_scripts' });
        createdDirectories.push('startup_scripts');
      }

      const vanilla = await call('kubevs_generate_recipe', {
        root,
        recipeId: `kubevs:${testId}_vanilla`,
        save: true,
        path: `server_scripts/${testId}_vanilla.js`,
        json: {
          type: 'minecraft:crafting_shapeless',
          ingredients: [{ item: 'minecraft:stone' }],
          result: { id: 'minecraft:diamond', count: 1 },
        },
      });
      const recipe = remember(vanilla.result);
      assert.match(recipe.content, /ServerEvents\.recipes/);
      const firstRead = await call('kubevs_read_file', { root, path: recipe.path });
      assert.equal(firstRead.content, recipe.content);
      assert.match(firstRead.revision, /^[a-f0-9]{64}$/);
      await expectToolError(
        'kubevs_write_file',
        { root, path: recipe.path, content: 'stale', expectedRevision: '0'.repeat(64) },
        /revision/i,
      );
      const updated = await call('kubevs_write_file', {
        root,
        path: recipe.path,
        content: `${firstRead.content}\n// MCP acceptance\n`,
        expectedRevision: firstRead.revision,
      });
      assert.notEqual(updated.revision, firstRead.revision);
      assert.equal(
        (await call('kubevs_read_file', { root, path: recipe.path })).revision,
        updated.revision,
      );

      const mechanical = await call('kubevs_generate_mod_recipe', {
        root,
        save: true,
        path: `server_scripts/${testId}_mechanical.js`,
        draft: {
          type: 'create:mechanical_crafting',
          recipeId: `kubevs:${testId}_mechanical`,
          outputs: [{ item: 'minecraft:diamond', count: 1, chance: 1 }],
          mechanical: {
            pattern: ['AAAAA', 'A   A', 'A B A', 'A   A', 'AAAAA'],
            key: { A: 'minecraft:stone', B: 'minecraft:iron_ingot' },
            acceptMirrored: false,
          },
        },
      });
      assert.match(remember(mechanical).content, /mechanical_crafting/);

      const gt = await call('kubevs_generate_gregtech_recipe', {
        root,
        save: true,
        machine: 'assembler',
        recipeId: `kubevs:${testId}_gregtech`,
        itemInputs: ['2x minecraft:iron_ingot'],
        itemOutputs: [{ item: 'minecraft:iron_block', count: 1 }],
        nonConsumableItems: ['minecraft:stick'],
        circuit: 2,
        duration: 200,
        eut: 30,
        path: `server_scripts/${testId}_gregtech.js`,
      });
      const gtFile = remember(gt);
      assert.match(gtFile.content, /event\.recipes\.gtceu\.assembler/);
      assert.match(gtFile.content, /notConsumableItem/);
      assert.match(gtFile.content, /\.EUt\(30, 1\)/);
      await expectToolError(
        'kubevs_generate_gregtech_recipe',
        {
          machine: 'assembler); malicious()',
          recipeId: `kubevs:${testId}_unsafe`,
          duration: 20,
          eut: 30,
        },
        /machine|invalid|regex/i,
      );

      const loot = await call('kubevs_generate_loot', {
        root,
        save: true,
        draft: {
          targetKind: 'block',
          target: 'minecraft:stone',
          condition: { id: 'root', kind: 'chance', value: 1, children: [] },
          actions: [{ id: 'drop', kind: 'add', item: 'minecraft:emerald', count: 1, chance: 1 }],
        },
        path: `server_scripts/${testId}_loot.js`,
      });
      assert.match(remember(loot).content, /LootJS|LootEvents/);

      for (const kind of ['item', 'block']) {
        const result = await call('kubevs_generate_content', {
          root,
          save: true,
          kind,
          id: `kubevs:${testId}_${kind}`,
          displayName: `MCP ${kind}`,
          path: `startup_scripts/${testId}_${kind}.js`,
        });
        const saved = remember(result);
        assert.match(saved.path, /^startup_scripts\//);
      }

      const diagnostics = await call('kubevs_diagnostics', { root, path: recipe.path });
      assert.ok(
        Array.isArray(diagnostics),
        `unexpected diagnostics: ${JSON.stringify(diagnostics)}`,
      );
      assert.equal(
        vscode.window.tabGroups.all.reduce((count, group) => count + group.tabs.length, 0),
        tabsBefore,
      );
    } catch (error) {
      primaryError = error;
    } finally {
      const cleanupErrors = [];
      for (const [filePath, fileRoot] of created) {
        try {
          const current = await call('kubevs_read_file', { root: fileRoot, path: filePath });
          const deleted = await call('kubevs_delete_file', {
            root: fileRoot,
            path: filePath,
            expectedRevision: current.revision,
          });
          assert.equal(deleted.deleted, true);
        } catch (error) {
          cleanupErrors.push(`${filePath}: ${error.message}`);
        }
      }
      for (const directory of createdDirectories.reverse()) {
        try {
          const folder = vscode.workspace.workspaceFolders[Number(root.slice('local:'.length))];
          await vscode.workspace.fs.delete(vscode.Uri.joinPath(folder.uri, directory));
        } catch (error) {
          cleanupErrors.push(`${directory}: ${error.message}`);
        }
      }
      await transport
        .close()
        .catch((error) => cleanupErrors.push(`client close: ${error.message}`));
      await vscode.commands
        .executeCommand('kubevs.__test.mcpStop')
        .catch((error) => cleanupErrors.push(`MCP stop: ${error.message}`));
      await assert
        .rejects(fetch(url, { headers: { Authorization: `Bearer ${token}` } }))
        .catch((error) => cleanupErrors.push(`endpoint still available: ${error.message}`));
      if (cleanupErrors.length)
        throw new Error(`MCP cleanup failed: ${cleanupErrors.join('; ')}`, { cause: primaryError });
    }
    if (primaryError) throw primaryError;
  });
});
