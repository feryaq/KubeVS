const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vscode = require('vscode');

suite('KubeVS MCP workspace', () => {
  const command = 'kubevs.__test.mcpWorkspace';
  const call = (operation, params = {}) =>
    vscode.commands.executeCommand(command, { operation, ...params });
  let base;
  let prefix;
  let root;

  suiteSetup(async () => {
    const extension = vscode.extensions.getExtension('kubevs.kubevs-extension');
    await extension.activate();
    base = vscode.workspace.workspaceFolders[0].uri.fsPath;
    prefix = `server_scripts/mcp-test-${Date.now()}`;
    const roots = await call('roots');
    root = roots.find((item) => !item.remote)?.id;
    assert.ok(root);
    await call('mkdir', { root, path: prefix });
    await call('mkdir', { root, path: 'client_scripts' });
  });

  suiteTeardown(async () => {
    await fs.rm(path.join(base, prefix), { recursive: true, force: true });
  });

  test('lists only KubeJS content and paginates direct children', async () => {
    const roots = await call('roots');
    assert.ok(roots.some((item) => item.id === root));
    const listing = await call('list', { root, path: '', limit: 2 });
    assert.ok(listing.total >= listing.entries.length);
    assert.equal(listing.entries.length, 2);
    assert.equal(listing.hasMore, listing.total > 2);
    assert.ok(
      listing.entries.every((item) => !item.path.startsWith('.') && !item.path.includes('token')),
    );
    const child = await call('list', { root, path: prefix });
    assert.equal(child.total, 0);
  });

  test('creates, reads, changes, copies and deletes UTF-8 with revisions', async () => {
    const file = `${prefix}/café.js`;
    const copy = `${prefix}/copy.js`;
    const created = await call('write', { root, path: file, content: 'const café = "✓"\n' });
    assert.equal(created.content, 'const café = "✓"\n');
    assert.match(created.revision, /^[a-f0-9]{64}$/);
    assert.deepEqual(await call('read', { root, path: file }), created);
    await assert.rejects(
      call('write', { root, path: file, content: 'overwrite' }),
      /expectedRevision|exists/i,
    );
    await assert.rejects(
      call('write', { root, path: file, content: 'stale', expectedRevision: '0'.repeat(64) }),
      /revision/i,
    );
    const updated = await call('write', {
      root,
      path: file,
      content: 'new ✓\n',
      expectedRevision: created.revision,
    });
    assert.notEqual(updated.revision, created.revision);
    await call('move', {
      root,
      path: file,
      destination: copy,
      expectedRevision: updated.revision,
      copy: true,
    });
    assert.equal((await call('read', { root, path: copy })).content, updated.content);
    await assert.rejects(
      call('delete', { root, path: file, expectedRevision: created.revision }),
      /revision/i,
    );
    assert.equal(
      (await call('delete', { root, path: file, expectedRevision: updated.revision })).deleted,
      true,
    );
  });

  test('creates nested parents for generator output and keeps mkdir idempotent', async () => {
    const nested = `${prefix}/kubevs/crafts/generic/token.js`;
    const created = await call('write', {
      root,
      path: nested,
      content: 'ServerEvents.recipes(() => {})\n',
    });
    assert.equal((await call('read', { root, path: nested })).revision, created.revision);
    const destination = `${prefix}/other/deep/token.js`;
    await call('move', {
      root,
      path: nested,
      destination,
      expectedRevision: created.revision,
      copy: true,
    });
    assert.equal((await call('read', { root, path: destination })).content, created.content);
    await call('mkdir', { root, path: `${prefix}/other/deep` });
    await call('mkdir', { root, path: `${prefix}/other/deep` });
  });

  test('rejects traversal, private paths and symlink escape', async () => {
    for (const candidate of [
      '../config/token.txt',
      '/tmp/x',
      'server_scripts/../../config',
      'server_scripts\\x.js',
      'https://x/y',
      'server_scripts/a:b.js',
      'config/secret.txt',
      '.git/config',
    ]) {
      await assert.rejects(call('read', { root, path: candidate }));
    }
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'kubevs-mcp-outside-'));
    const link = path.join(base, prefix, 'escape');
    try {
      await fs.writeFile(path.join(outside, 'outside.js'), 'outside');
      await fs.symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
      await assert.rejects(
        call('read', { root, path: `${prefix}/escape/outside.js` }),
        /symbolic/i,
      );
      await assert.rejects(
        call('write', { root, path: `${prefix}/escape/new.js`, content: 'x' }),
        /symbolic/i,
      );
    } finally {
      await fs.rm(link, { force: true });
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  test('omits hidden credentials and rejects binary or oversized content', async () => {
    const secret = path.join(base, prefix, '.env');
    const binary = path.join(base, prefix, 'binary.js');
    await fs.writeFile(secret, 'PRIVATE_VALUE');
    await fs.writeFile(binary, Buffer.from([0, 1, 2]));
    const listed = await call('list', { root, path: prefix });
    assert.ok(!listed.entries.some((entry) => entry.path.endsWith('/.env')));
    await assert.rejects(call('read', { root, path: `${prefix}/binary.js` }), /binary/i);
    await assert.rejects(
      call('write', { root, path: `${prefix}/large.js`, content: 'x'.repeat(512 * 1024 + 1) }),
      /512 KiB/i,
    );
  });

  test('rejects mutation while a local document has unsaved edits', async () => {
    const file = `${prefix}/dirty.js`;
    const original = await call('write', { root, path: file, content: 'old\n' });
    const uri = vscode.Uri.file(path.join(base, file));
    const document = await vscode.workspace.openTextDocument(uri);
    const edit = new vscode.WorkspaceEdit();
    edit.insert(uri, new vscode.Position(0, 0), 'dirty ');
    assert.equal(await vscode.workspace.applyEdit(edit), true);
    assert.equal(document.isDirty, true);
    await assert.rejects(
      call('write', { root, path: file, content: 'new\n', expectedRevision: original.revision }),
      /unsaved/i,
    );
    await assert.rejects(
      call('delete', { root, path: file, expectedRevision: original.revision }),
      /unsaved/i,
    );
    await document.save();
  });
});
