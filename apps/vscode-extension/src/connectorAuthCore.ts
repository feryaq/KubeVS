export function connectorCredentialKey(host: string, port: number): string {
  const normalizedHost = host
    .trim()
    .toLowerCase()
    .replace(/^\[(.*)\]$/u, '$1');
  return `kubevs.connector.token.v2.${encodeURIComponent(normalizedHost)}.${port}`;
}

export function parseConnectorToken(value: string): string {
  const token = value.trim();
  if (token.length < 32 || token.length > 256) {
    throw new Error('Connector token must contain 32 to 256 characters.');
  }
  if (!/^[A-Za-z0-9_-]+$/u.test(token)) {
    throw new Error('Connector token contains unsupported characters.');
  }
  return token;
}

export function isConnectorAuthenticationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /(?:\b401\b|unauthori[sz]ed|authentication|invalid token|forbidden)/iu.test(message);
}

export interface ConnectorConnectionCode {
  readonly host: string;
  readonly port: number;
  readonly token: string;
  readonly secure: boolean;
}

export function parseConnectorConnectionCode(value: string): ConnectorConnectionCode {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('The connection code is corrupted. Copy it again from /kvs join.');
  }
  if (url.protocol !== 'kubevs:' || !url.hostname || url.username || url.password || url.hash) {
    throw new Error('This is not a KubeVS connection code.');
  }
  const port = url.port ? Number.parseInt(url.port, 10) : 32145;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('The connection code contains an invalid port.');
  }
  const token = parseConnectorToken(url.searchParams.get('token') ?? '');
  const secureValue = url.searchParams.get('secure');
  if (secureValue !== null && secureValue !== 'true' && secureValue !== 'false') {
    throw new Error('The connection code has an invalid TLS setting.');
  }
  return {
    host: url.hostname.replace(/^\[(.*)\]$/u, '$1'),
    port,
    token,
    secure: secureValue === 'true',
  };
}
