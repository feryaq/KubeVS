/** Focus-safe visual/interaction checks against the production template webview. */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import Module, { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const directory = path.resolve(process.argv[2] || 'artifacts/templates-1.9.0');
const runtime = path.join(
  os.homedir(),
  '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json',
);
const { chromium } = createRequire(runtime)('playwright');
const original = Module._load;
Module._load = function (name, ...args) {
  if (name === 'vscode')
    return { workspace: { workspaceFolders: [] }, Uri: {}, ExtensionMode: { Test: 3 } };
  return original.call(this, name, ...args);
};
const backend = createRequire(import.meta.url)(path.join(directory, 'preview-backend.cjs'));
Module._load = original;
const browser = await chromium.launch({
  headless: true,
  ...(process.env.KUBEVS_PLAYWRIGHT_EXECUTABLE_PATH
    ? { executablePath: process.env.KUBEVS_PLAYWRIGHT_EXECUTABLE_PATH }
    : {}),
});
const out = path.join(directory, 'screenshots');
await fs.mkdir(out, { recursive: true });
const fixture = {
  type: 'example:pressure_chamber',
  inputs: [{ item: 'minecraft:iron_ingot' }],
  results: [{ id: 'example:compressed_iron' }],
  pressure: 2,
  mode: 'low',
  conditions: [{ type: 'example:temperature', value: 300 }],
};
const send = (page, message) =>
  page.evaluate(
    (value) => window.dispatchEvent(new MessageEvent('message', { data: value })),
    message,
  );
async function last(page, type) {
  return page.evaluate((type) => window.messages.filter((m) => m.type === type).at(-1), type);
}
async function preview(page, schema) {
  await page.waitForTimeout(180);
  const request = await last(page, 'previewTemplate');
  assert.ok(request);
  const next = backend.parseRecipeSchema({
    ...schema,
    id: request.id,
    label: request.label,
    fields: request.fields,
  });
  await send(page, {
    type: 'templatePreview',
    revision: request.revision,
    recipe: backend.buildRecipeFromSchema(next, { values: {} }),
  });
  return request;
}
const report = [];
try {
  for (const theme of ['dark', 'light'])
    for (const width of [1440, 800, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto('file://' + path.join(directory, 'templates.html'));
      if (theme === 'light')
        await page.addStyleTag({
          content:
            ':root{--vscode-editor-background:#fafafa;--vscode-editor-foreground:#242730;--vscode-input-background:#fff;--vscode-input-foreground:#242730;--vscode-panel-border:#c9ced8;--vscode-descriptionForeground:#626977;--vscode-button-secondaryBackground:#e5e7ec;--vscode-button-secondaryForeground:#242730;--vscode-input-placeholderForeground:#626977;--vscode-errorForeground:#b32626}',
        });
      await page.locator('#source').fill(JSON.stringify(fixture, null, 2));
      await page.locator('#name').fill('Pressure chamber');
      await page.locator('#infer').click();
      assert.equal(
        await page.locator('#source').isDisabled(),
        true,
        'Source locks during inference',
      );
      const request = await last(page, 'infer');
      const schema = backend.inferRecipeSchemaFromJson({
        id: request.id,
        label: request.label,
        json: JSON.parse(request.source),
      });
      await send(page, { type: 'inferred', revision: request.revision, schema });
      await preview(page, schema);
      assert.equal(await page.locator('#save').isEnabled(), true);
      const condition = page
        .locator('.field-row')
        .filter({ has: page.locator('code', { hasText: 'conditions' }) });
      await condition.locator('input[type=checkbox]').uncheck();
      const draft = await preview(page, schema);
      assert.ok(!draft.fields.some((f) => f.path === 'conditions'));
      assert.deepEqual(
        JSON.parse(await page.locator('#preview').textContent()).conditions,
        fixture.conditions,
      );
      const pressure = page
        .locator('.field-row')
        .filter({ has: page.locator('code', { hasText: 'pressure' }) });
      const stale = await last(page, 'previewTemplate');
      await pressure.locator('.default-input').fill('5');
      await send(page, {
        type: 'templatePreview',
        revision: stale.revision,
        recipe: { stale: true },
      });
      assert.equal(
        await page.locator('#save').isDisabled(),
        true,
        'Stale replies cannot enable save',
      );
      await preview(page, schema);
      assert.equal(JSON.parse(await page.locator('#preview').textContent()).pressure, 5);
      await pressure.locator('.default-input').fill('broken');
      await page.waitForTimeout(180);
      assert.equal(await page.locator('#save').isDisabled(), true);
      assert.match(await page.locator('#status').textContent(), /valid JSON/);
      await pressure.locator('.default-input').fill('5');
      await preview(page, schema);
      const mode = page
        .locator('.field-row')
        .filter({ has: page.locator('code', { hasText: 'mode' }) });
      await mode.locator('select').selectOption('enum');
      await mode.locator('.enum-options').fill('["low","high"]');
      await mode.locator('.default-input').fill('"high"');
      const enumRequest = await preview(page, schema);
      assert.deepEqual(enumRequest.fields.find((field) => field.path === 'mode').options, [
        'low',
        'high',
      ]);
      assert.equal(JSON.parse(await page.locator('#preview').textContent()).mode, 'high');
      await page.locator('summary').click();
      await preview(page, schema);
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        'No horizontal clipping',
      );
      await page.screenshot({
        path: path.join(out, `templates-${theme}-${width}.png`),
        fullPage: true,
      });
      await page.locator('#save').click();
      assert.equal(await page.locator('#name').isDisabled(), true);
      const save = await last(page, 'saveTemplate');
      assert.equal(save.fields.find((f) => f.path === 'pressure').default, 5);
      await send(page, {
        type: 'templateSaved',
        revision: save.revision,
        path: '.kubevs/recipe-packs/example.kubevs-pack.json',
      });
      assert.equal(await page.locator('#save').isEnabled(), true);
      await page.locator('#source').fill('{}');
      assert.equal(await page.locator('#save').isDisabled(), true);
      assert.equal(await page.locator('.field-row').count(), 0, 'Source edits clear old fields');
      assert.deepEqual(errors, []);
      report.push({
        theme,
        width,
        checks: [
          'inference',
          'friendly fields',
          'static data retained',
          'stale reply ignored',
          'invalid defaults blocked',
          'save locks controls',
          'source invalidation',
          'no horizontal overflow',
        ],
      });
      await page.close();
    }
  await fs.writeFile(
    path.join(directory, 'templates-visual-report.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(`PASS: ${report.length} template layouts and interaction flows`);
} finally {
  await browser.close();
}
