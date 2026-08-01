import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { WebSocketServer } from 'ws';

const require = createRequire(import.meta.url);
const { ConnectorClient } = require('../dist/connectorClient.cjs');

test('authenticates, validates hello, and resolves request responses', async () => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert.equal(typeof address, 'object');

  server.on('connection', (socket, request) => {
    assert.equal(request.headers.authorization, 'Bearer test-token');
    socket.send(
      JSON.stringify({
        type: 'hello',
        protocolVersion: 1,
        connectorVersion: 'test',
        minecraftVersion: '1.21.1',
        kubejsVersion: null,
        capabilities: {
          registries: true,
          recipes: true,
          logs: true,
          reload: false,
          inspect: false,
          integrations: [],
        },
      }),
    );
    socket.on('message', (data) => {
      const requestMessage = JSON.parse(data.toString());
      socket.send(
        JSON.stringify({
          type: 'response',
          requestId: requestMessage.requestId,
          ok: true,
          result: { total: 42 },
        }),
      );
    });
  });

  const client = new ConnectorClient();
  const hello = await client.connect(`ws://127.0.0.1:${address.port}`, 'test-token');
  assert.equal(hello.minecraftVersion, '1.21.1');
  const result = await client.request('registry.items', { limit: 1 });
  assert.deepEqual(result, { total: 42 });
  client.disconnect();
  await new Promise((resolve) => server.close(resolve));
});
