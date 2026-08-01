import WebSocket from 'ws';
import {
  isConnectorMessage,
  PROTOCOL_VERSION,
  type ConnectorError,
  type ConnectorHello,
  type ConnectorRequest,
  type ConnectorResponse,
} from '@kubevs/protocol';

interface PendingRequest {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timer: NodeJS.Timeout;
}

export class ConnectorClient {
  private socket: WebSocket | undefined;
  private readonly pending = new Map<string, PendingRequest>();
  private nextRequestId = 1;
  private hello: ConnectorHello | undefined;

  get capabilities(): ConnectorHello['capabilities'] | undefined {
    return this.hello?.capabilities;
  }

  async connect(url: string, token: string): Promise<ConnectorHello> {
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
          reject(error);
        }
      };

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
            resolve(value);
          }
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
      });
    });
  }

  async request<T>(method: string, params: Readonly<Record<string, unknown>> = {}): Promise<T> {
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
    if (socket) socket.close(1000, 'Extension disconnected');
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
      const revision =
        message.code === 'REVISION_CONFLICT' && message.actualRevision
          ? ` (текущая ревизия ${message.actualRevision})`
          : '';
      pending.reject(new Error(`${message.code}: ${message.message}${revision}`));
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
