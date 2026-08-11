import WebSocket from 'ws';
import {
  isConnectorMessage,
  PROTOCOL_VERSION,
  type ConnectorError,
  type ConnectorEvent,
  type ConnectorHello,
  type ConnectorRequest,
  type ConnectorResponse,
} from '@kubevs/protocol';

export class ConnectorRequestError extends Error {
  constructor(
    readonly code: ConnectorError['code'],
    message: string,
    readonly actualRevision?: string,
  ) {
    super(message);
    this.name = 'ConnectorRequestError';
  }
}

interface PendingRequest {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timer: NodeJS.Timeout;
}

export class ConnectorClient {
  constructor(private readonly rateLimitRetryMs = 10_100) {}
  private socket: WebSocket | undefined;
  private readonly pending = new Map<string, PendingRequest>();
  private nextRequestId = 1;
  private hello: ConnectorHello | undefined;
  private readonly eventListeners = new Set<(event: ConnectorEvent) => void>();
  private readonly disconnectListeners = new Set<(error: Error) => void>();
  private readonly expectedCloses = new WeakSet<WebSocket>();

  get capabilities(): ConnectorHello['capabilities'] | undefined {
    return this.hello?.capabilities;
  }

  get session(): ConnectorHello['session'] | undefined {
    return this.hello?.session;
  }

  onEvent(listener: (event: ConnectorEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onDisconnect(listener: (error: Error) => void): () => void {
    this.disconnectListeners.add(listener);
    return () => this.disconnectListeners.delete(listener);
  }

  async connect(url: string, token: string, helloTimeoutMs = 8_000): Promise<ConnectorHello> {
    this.disconnect();
    return await new Promise<ConnectorHello>((resolve, reject) => {
      let settled = false;
      const socket = new WebSocket(url, {
        headers: { Authorization: `Bearer ${token}` },
        handshakeTimeout: 5000,
        maxPayload: 8_388_608,
        perMessageDeflate: false,
      });
      this.socket = socket;

      const failInitial = (error: Error): void => {
        if (!settled) {
          settled = true;
          if (helloTimer) clearTimeout(helloTimer);
          reject(error);
        }
      };

      const helloTimer = setTimeout(() => {
        failInitial(new Error('Connector did not send hello within the connection timeout'));
        this.expectedCloses.add(socket);
        socket.terminate();
      }, helloTimeoutMs);

      socket.on('message', (data, isBinary) => {
        if (isBinary) {
          socket.close(1003, 'Text messages required');
          return;
        }
        let value: unknown;
        try {
          value = JSON.parse(data.toString());
        } catch {
          socket.close(1007, 'Invalid JSON');
          return;
        }
        if (!isConnectorMessage(value)) {
          socket.close(1007, 'Invalid protocol message');
          return;
        }
        if (value.type === 'hello') {
          if (value.protocolVersion !== PROTOCOL_VERSION) {
            const error = new Error(
              `Protocol mismatch: extension=${PROTOCOL_VERSION}, connector=${value.protocolVersion}`,
            );
            failInitial(error);
            socket.close(1002, 'Protocol mismatch');
            return;
          }
          this.hello = value;
          if (!settled) {
            settled = true;
            if (helloTimer) clearTimeout(helloTimer);
            resolve(value);
          }
          return;
        }
        if (value.type === 'event') {
          for (const listener of this.eventListeners) listener(value);
          return;
        }
        this.completeRequest(value);
      });
      socket.on('error', (error) => failInitial(error));
      socket.on('close', (code, reason) => {
        if (this.socket === socket) {
          this.socket = undefined;
          this.hello = undefined;
        }
        const error = new Error(
          `Connector closed (${code})${reason.length > 0 ? `: ${reason.toString()}` : ''}`,
        );
        failInitial(error);
        this.rejectPending(error);
        if (!this.expectedCloses.has(socket)) {
          for (const listener of this.disconnectListeners) listener(error);
        }
      });
    });
  }

  async request<T>(method: string, params: Readonly<Record<string, unknown>> = {}): Promise<T> {
    try {
      return await this.requestOnce<T>(method, params);
    } catch (error) {
      if (!(error instanceof ConnectorRequestError) || error.code !== 'RATE_LIMITED') throw error;
      await new Promise((resolve) => setTimeout(resolve, this.rateLimitRetryMs));
      return await this.requestOnce<T>(method, params);
    }
  }

  private async requestOnce<T>(
    method: string,
    params: Readonly<Record<string, unknown>>,
  ): Promise<T> {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN || !this.hello) {
      throw new Error('KubeVS Connector is not connected');
    }
    const requestId = String(this.nextRequestId++);
    const message: ConnectorRequest = { type: 'request', requestId, method, params };
    return await new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`Connector request timed out: ${method}`));
      }, 10_000);
      this.pending.set(requestId, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
      socket.send(JSON.stringify(message), (error) => {
        if (error) {
          const pending = this.pending.get(requestId);
          if (pending) {
            clearTimeout(pending.timer);
            this.pending.delete(requestId);
            pending.reject(error);
          }
        }
      });
    });
  }

  disconnect(): void {
    const socket = this.socket;
    this.socket = undefined;
    this.hello = undefined;
    if (socket) {
      this.expectedCloses.add(socket);
      socket.close(1000, 'Extension disconnected');
    }
    this.rejectPending(new Error('Connector disconnected'));
  }

  private completeRequest(message: ConnectorResponse | ConnectorError): void {
    if (!message.requestId) return;
    const pending = this.pending.get(message.requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.requestId);
    if (message.type === 'response') pending.resolve(message.result);
    else {
      pending.reject(
        new ConnectorRequestError(message.code, message.message, message.actualRevision),
      );
    }
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
