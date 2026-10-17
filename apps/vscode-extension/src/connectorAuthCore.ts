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

/** Recovery text for the current endpoint; never echoes a pasted connection code. */
export function describeConnectorConnectionError(
  error: unknown,
  host: string,
  port: number,
): string {
  const message = error instanceof Error ? error.message : String(error);
  if (isConnectorAuthenticationError(error)) {
    return 'Access was rejected. Run /kvs join again and paste the new code. Ask a server operator to check your role if access is still denied.';
  }
  if (/ECONNREFUSED/iu.test(message)) {
    return `No Connector is listening at ${host}:${port}. Open a Minecraft world or start the server, then check network.port in kubevs-connector.toml.`;
  }
  if (/ENOTFOUND|EAI_AGAIN/iu.test(message)) {
    return `Could not resolve ${host}. Check the server address and network.publicHost in kubevs-connector.toml.`;
  }
  if (/timeout|ETIMEDOUT|did not send hello/iu.test(message)) {
    return `Connector at ${host}:${port} did not respond. Check the server is running and its separate Connector port is reachable.`;
  }
  if (/protocol mismatch/iu.test(message)) {
    return 'The extension and Connector use different protocols. Install matching KubeVS versions, restart Minecraft, and reconnect.';
  }
  if (/certificate|TLS|SSL/iu.test(message)) {
    return 'The secure connection failed. Check the TLS proxy certificate and network.publicSecure before requesting a new /kvs join code.';
  }
  return message
    .replace(/kubevs:\/\/[^\s]+/giu, '[connection code]')
    .replace(/token=[A-Za-z0-9_-]+/giu, 'token=[hidden]')
    .slice(0, 500);
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
