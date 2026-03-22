/**
 * Gateway WebSocket client for the Agent Daemon.
 *
 * Connects to the Gateway's /ws/daemon endpoint, sends registration,
 * and provides bidirectional message passing.
 */

import type {
  DaemonConfig,
  DaemonToGateway,
  GatewayToDaemon,
} from "../gateway/types.js";
import { isGatewayToDaemonMessage } from "../gateway/types.js";

export class GatewayClient {
  private config: DaemonConfig;
  private ws: import("ws").default | null = null;

  /** Called when a message should be "sent" — allows interception in tests. */
  onSend: ((msg: DaemonToGateway) => void) | null = null;

  /** Called when a message is received from the Gateway. */
  onMessage: ((msg: GatewayToDaemon) => void) | null = null;

  /** Called when the connection closes. */
  onClose: (() => void) | null = null;

  constructor(config: DaemonConfig) {
    this.config = config;
  }

  /**
   * Connect to the Gateway and send registration.
   */
  connect(daemonId: string, capacity: number): void {
    const registerMsg: DaemonToGateway = {
      type: "register",
      daemon_id: daemonId,
      capacity,
    };

    // Send registration immediately (for test compatibility)
    this.onSend?.(registerMsg);

    // In production, we'd create a real WebSocket here
    this._connectWs(registerMsg);
  }

  private _connectWs(registerMsg: DaemonToGateway): void {
    try {
      // Dynamic import to avoid issues when ws is mocked
      import("ws").then((wsModule) => {
        const WS = wsModule.default;
        this.ws = new WS(this.config.gateway_url, {
          headers: { authorization: `Bearer ${this.config.api_key}` },
        });

        this.ws.onopen = () => {
          this.ws?.send(JSON.stringify(registerMsg));
        };

        this.ws.onmessage = (event: { data: unknown }) => {
          const data = typeof event.data === "string" ? event.data : String(event.data);
          this.handleIncoming(JSON.parse(data));
        };

        this.ws.onclose = () => {
          this.onClose?.();
        };

        this.ws.onerror = () => {
          // Connection errors are handled by onclose
        };
      });
    } catch {
      // WebSocket connection failed — will be handled by reconnect logic
    }
  }

  /**
   * Handle an incoming message from the Gateway.
   * Can be called directly in tests to simulate messages.
   */
  handleIncoming(msg: GatewayToDaemon): void {
    if (isGatewayToDaemonMessage(msg)) {
      this.onMessage?.(msg);
    }
  }

  /**
   * Send a message to the Gateway.
   */
  sendMessage(msg: DaemonToGateway): void {
    this.onSend?.(msg);

    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  /**
   * Close the WebSocket connection.
   */
  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
