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
        protocolVersion: 2,
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
    socket.send(
      JSON.stringify({
        type: 'event',
        event: 'workspace.changed',
        data: { change: 'changed', path: 'server_scripts/main.js' },
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
  const events = [];
  client.onEvent((event) => events.push(event));
  const hello = await client.connect(`ws://127.0.0.1:${address.port}`, 'test-token');
  assert.equal(hello.minecraftVersion, '1.21.1');
  const result = await client.request('registry.items', { limit: 1 });
  assert.deepEqual(result, { total: 42 });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(events.length, 1);
  assert.equal(events[0].event, 'workspace.changed');
  client.disconnect();
  await new Promise((resolve) => server.close(resolve));
});

test('reports an unexpected server-side session revocation', async () => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert.equal(typeof address, 'object');

  server.on('connection', (socket) => {
    socket.send(
      JSON.stringify({
        type: 'hello',
        protocolVersion: 2,
        connectorVersion: 'test',
        minecraftVersion: '1.21.1',
        kubejsVersion: 'test',
        capabilities: {
          registries: true,
          recipes: true,
          logs: false,
          reload: false,
          inspect: false,
          integrations: [],
        },
      }),
    );
    setTimeout(() => socket.close(1008, 'Role changed'), 20);
  });

  const client = new ConnectorClient();
  const disconnected = new Promise((resolve) => client.onDisconnect(resolve));
  await client.connect(`ws://127.0.0.1:${address.port}`, 'test-token');
  const error = await disconnected;
  assert.match(error.message, /1008.*Role changed/u);
  await new Promise((resolve) => server.close(resolve));
});

test('times out when a WebSocket opens but Connector never sends hello', async () => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert.equal(typeof address, 'object');

  const client = new ConnectorClient();
  await assert.rejects(
    client.connect(`ws://127.0.0.1:${address.port}`, 'test-token', 50),
    /did not send hello/u,
  );
  await new Promise((resolve) => server.close(resolve));
});
test('retries one correlated rate-limit response after the configured delay', async () => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert.equal(typeof address, 'object');
  let requests = 0;

  server.on('connection', (socket) => {
    socket.send(
      JSON.stringify({
        type: 'hello',
        protocolVersion: 2,
        connectorVersion: 'test',
        minecraftVersion: '1.21.1',
        kubejsVersion: 'test',
        capabilities: {
          registries: true,
          recipes: true,
          logs: false,
          reload: false,
          inspect: false,
          integrations: [],
        },
      }),
    );
    socket.on('message', (data) => {
      const request = JSON.parse(data.toString());
      requests++;
      socket.send(
        JSON.stringify(
          requests === 1
            ? {
                type: 'error',
                requestId: request.requestId,
                code: 'RATE_LIMITED',
                message: 'Too many requests',
              }
            : {
                type: 'response',
                requestId: request.requestId,
                ok: true,
                result: { retried: true },
              },
        ),
      );
    });
  });

  const client = new ConnectorClient(5);
  await client.connect(`ws://127.0.0.1:${address.port}`, 'test-token');
  assert.deepEqual(await client.request('recipes.list'), { retried: true });
  assert.equal(requests, 2);
  client.disconnect();
  await new Promise((resolve) => server.close(resolve));
});
