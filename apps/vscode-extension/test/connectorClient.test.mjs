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

const validHello = {
  type: 'hello',
  protocolVersion: 2,
  connectorVersion: 'test',
  minecraftVersion: '1.21.1',
  kubejsVersion: null,
  capabilities: {
    registries: true,
    recipes: true,
    logs: false,
    reload: false,
    inspect: false,
    integrations: [],
  },
};
async function fixture(onConnection) {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise((resolve) => server.once('listening', resolve));
  server.on('connection', onConnection);
  return { server, url: `ws://127.0.0.1:${server.address().port}` };
}
async function closeFixture(server, client) {
  client.disconnect();
  for (const socket of server.clients) socket.terminate();
  await new Promise((resolve) => server.close(resolve));
}

test('a delayed close from the previous socket preserves the new session and requests', async () => {
  const { server, url } = await fixture((socket) => {
    socket.send(JSON.stringify(validHello));
    socket.on('message', (data) => {
      const request = JSON.parse(data.toString());
      setTimeout(
        () =>
          socket.send(
            JSON.stringify({
              type: 'response',
              requestId: request.requestId,
              ok: true,
              result: 'new session',
            }),
          ),
        30,
      );
    });
  });
  const client = new ConnectorClient();
  try {
    await client.connect(url, 'token');
    const oldSocket = client.socket;
    const originalClose = oldSocket.close.bind(oldSocket);
    oldSocket.close = () => {};
    await client.connect(url, 'token');
    const response = client.request('connector.status');
    originalClose();
    assert.equal(await response, 'new session');
    assert.equal(client.capabilities.registries, true);
  } finally {
    await closeFixture(server, client);
  }
});

test('disconnect settles an in-progress hello immediately', async () => {
  const { server, url } = await fixture(() => {});
  const client = new ConnectorClient();
  try {
    const connection = client.connect(url, 'token', 5000);
    const rejection = assert.rejects(connection, /disconnected/);
    client.disconnect();
    await rejection;
  } finally {
    await closeFixture(server, client);
  }
});

test('a rate-limit retry cannot run in a replacement session', async () => {
  let received = 0;
  const { server, url } = await fixture((socket) => {
    socket.send(JSON.stringify(validHello));
    socket.on('message', (data) => {
      const request = JSON.parse(data.toString());
      received++;
      socket.send(
        JSON.stringify({
          type: 'error',
          requestId: request.requestId,
          code: 'RATE_LIMITED',
          message: 'Wait',
        }),
      );
    });
  });
  const client = new ConnectorClient(250);
  try {
    await client.connect(url, 'token');
    const rateLimitProcessed = new Promise((resolve) => {
      client.socket.on('message', (data) => {
        if (JSON.parse(data.toString()).code === 'RATE_LIMITED') {
          // Run after the client's message handler and its promise reactions enter the retry delay.
          setImmediate(resolve);
        }
      });
    });
    // Handle rejection immediately; assertions below cannot leave an unhandled assertion promise.
    const outcome = client.request('workspace.files.write').then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
    await rateLimitProcessed;
    await client.connect(url, 'token');
    const result = await outcome;
    assert.match(result.error?.message ?? '', /session changed/);
    assert.equal(received, 1);
  } finally {
    await closeFixture(server, client);
  }
});

test('rejects malformed capabilities before accepting a connection', async () => {
  const { server, url } = await fixture((socket) =>
    socket.send(JSON.stringify({ ...validHello, capabilities: {} })),
  );
  const client = new ConnectorClient();
  try {
    await assert.rejects(client.connect(url, 'token'), /Invalid protocol message/);
  } finally {
    await closeFixture(server, client);
  }
});

test('reload policy events immediately update the shared hello capability', async () => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise((resolve) => server.once('listening', resolve));
  let peer;
  server.on('connection', (socket) => {
    peer = socket;
    socket.send(
      JSON.stringify({
        type: 'hello',
        protocolVersion: 2,
        connectorVersion: '1.7.0',
        minecraftVersion: '1.21.1',
        kubejsVersion: 'test',
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
  });
  const client = new ConnectorClient();
  try {
    const hello = await client.connect(`ws://127.0.0.1:${server.address().port}`, 'test-token');
    const changed = () =>
      new Promise((resolve) => {
        const stop = client.onEvent((event) => {
          if (event.event === 'session.permissionsChanged') {
            stop();
            resolve();
          }
        });
      });
    for (const enabled of [true, false]) {
      const pending = changed();
      peer.send(
        JSON.stringify({
          type: 'event',
          event: 'session.permissionsChanged',
          data: { reloadAllowed: enabled },
        }),
      );
      await pending;
      assert.equal(client.capabilities.reload, enabled);
      assert.equal(hello.capabilities.reload, enabled);
    }
  } finally {
    client.disconnect();
    await new Promise((resolve) => server.close(resolve));
  }
});
