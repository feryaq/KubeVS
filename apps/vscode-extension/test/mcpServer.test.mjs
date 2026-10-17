import assert from 'node:assert/strict';
import test from 'node:test';
import { request as httpRequest } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { z } from 'zod';
import { KubeVsMcpServer } from '../dist/mcpServer.mjs';

const token = 'test-local-mcp-token';

function fixture() {
  let trusted = true;
  let calls = 0;
  const server = new KubeVsMcpServer({
    version: '1.3.0',
    token,
    port: 0,
    isTrusted: () => trusted,
    tools: [
      {
        name: 'double',
        description: 'Double a number',
        inputSchema: { value: z.number().int() },
        async run({ value }) {
          calls++;
          return { doubled: value * 2 };
        },
      },
      {
        name: 'fails',
        description: 'Raise an application error',
        inputSchema: {},
        async run() {
          throw new Error('Example failure');
        },
      },
    ],
    resources: [
      {
        uri: 'kubevs://project/info',
        name: 'project-info',
        description: 'Project info',
        async read() {
          return { name: 'example' };
        },
      },
    ],
  });
  return {
    server,
    revoke: () => {
      trusted = false;
    },
    get calls() {
      return calls;
    },
  };
}

async function clientFor(url) {
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  return { client, transport };
}

test('real SDK client initializes and exchanges tools and resources', async () => {
  const app = fixture();
  const { url } = await app.server.start();
  const { client, transport } = await clientFor(url);
  try {
    assert.equal(app.server.running, true);
    assert.equal(app.server.url, url);
    assert.equal(client.getServerVersion().version, '1.3.0');
    const tools = await client.listTools();
    assert.deepEqual(
      tools.tools.map((tool) => tool.name),
      ['double', 'fails'],
    );
    assert.deepEqual(tools.tools[0].inputSchema.required, ['value']);
    const resources = await client.listResources();
    assert.equal(resources.resources[0].uri, 'kubevs://project/info');
    const result = await client.callTool({ name: 'double', arguments: { value: 4 } });
    assert.deepEqual(result.structuredContent, { result: { doubled: 8 } });
    assert.equal(JSON.parse(result.content[0].text).doubled, 8);
    const resource = await client.readResource({ uri: 'kubevs://project/info' });
    assert.deepEqual(JSON.parse(resource.contents[0].text), { name: 'example' });
    const failed = await client.callTool({ name: 'fails', arguments: {} });
    assert.equal(failed.isError, true);
    assert.match(failed.content[0].text, /Example failure/);
    assert.equal(app.calls, 1);
    const invalid = await client.callTool({ name: 'double', arguments: { value: 'wrong' } });
    assert.equal(invalid.isError, true);
    assert.equal(app.calls, 1);
    app.revoke();
    await assert.rejects(client.listTools());
  } finally {
    await transport.close();
    await app.server.stop();
  }
  assert.equal(app.server.running, false);
  assert.equal(app.server.url, undefined);
  await assert.rejects(fetch(url));
});

test('HTTP boundary rejects unauthenticated, browser, forged host, and invalid bodies', async () => {
  const app = fixture();
  const { url, port } = await app.server.start();
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' });
  const post = (overrides = {}) =>
    fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        ...overrides.headers,
      },
      body: overrides.body ?? body,
    });
  try {
    assert.equal((await fetch(url, { method: 'POST', body })).status, 401);
    assert.equal((await post({ headers: { authorization: 'Bearer wrong' } })).status, 401);
    assert.equal((await post({ headers: { origin: 'https://evil.example' } })).status, 403);
    const forgedHostStatus = await new Promise((resolve, reject) => {
      const request = httpRequest(
        url,
        {
          method: 'POST',
          headers: {
            host: 'evil.example',
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
        },
        (response) => {
          response.resume();
          resolve(response.statusCode);
        },
      );
      request.on('error', reject);
      request.end(body);
    });
    assert.equal(forgedHostStatus, 403);
    assert.notEqual((await post({ headers: { host: `localhost:${port}` } })).status, 403);
    assert.equal((await fetch(url, { headers: { authorization: `Bearer ${token}` } })).status, 405);
    assert.equal(
      (await fetch(url, { method: 'DELETE', headers: { authorization: `Bearer ${token}` } }))
        .status,
      405,
    );
    assert.equal((await post({ headers: { 'content-type': 'text/plain' } })).status, 415);
    assert.equal((await post({ body: '{bad json' })).status, 400);
    assert.equal((await post({ body: 'x'.repeat(1024 * 1024 + 1) })).status, 413);
    app.revoke();
    assert.equal((await post()).status, 403);
  } finally {
    await app.server.stop();
  }
});

test('listener can restart after stop', async () => {
  const app = fixture();
  await app.server.start();
  await app.server.stop();
  const { url } = await app.server.start();
  const { transport } = await clientFor(url);
  await transport.close();
  await app.server.stop();
});
