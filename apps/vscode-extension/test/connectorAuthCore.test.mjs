import assert from 'node:assert/strict';
import test from 'node:test';
import {
  connectorCredentialKey,
  isConnectorAuthenticationError,
  parseConnectorToken,
} from '../dist/connectorAuthCore.mjs';

test('normalizes endpoint credential keys', () => {
  assert.equal(connectorCredentialKey('[::1]', 32145), connectorCredentialKey('::1', 32145));
  assert.equal(
    connectorCredentialKey('LOCALHOST', 32145),
    connectorCredentialKey('localhost', 32145),
  );
  assert.notEqual(
    connectorCredentialKey('localhost', 32145),
    connectorCredentialKey('localhost', 32146),
  );
});

test('trims valid tokens and rejects malformed values', () => {
  const token = 'abcdefghijklmnopqrstuvwxyzABCDEFG_123456789';
  assert.equal(parseConnectorToken(`  ${token}\n`), token);
  assert.throws(() => parseConnectorToken('short'), /32 to 256/u);
  assert.throws(() => parseConnectorToken(`${token}!`), /unsupported characters/u);
});

test('recognizes authentication failures without swallowing network failures', () => {
  assert.equal(isConnectorAuthenticationError(new Error('Unexpected server response: 401')), true);
  assert.equal(isConnectorAuthenticationError(new Error('Authentication failed')), true);
  assert.equal(isConnectorAuthenticationError(new Error('ECONNREFUSED')), false);
});
