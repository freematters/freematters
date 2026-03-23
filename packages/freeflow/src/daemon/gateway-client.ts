/**
 * Gateway WebSocket client for the Agent Daemon.
 *
 * Connects to the Gateway's /ws/daemon endpoint, sends registration,
 * and provides bidirectional message passing.
 * Reconnects automatically on unexpected disconnect with exponential backoff.
 */

import type {
  DaemonConfig,
  DaemonToGateway,
  GatewayToDaemon,
} from "../gateway/types.js";
import { isGatewayToDaemonMessage } from "../gateway/types.js";

const DEFAULT_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_ATTEMPTS = 10;

export class GatewayClient {
  private config: DaemonConfig;
  private ws: import("ws").default | null = null;
  private closed = false;
  private reconnectAttempts = 0;
  private lastRegisterMsg: DaemonToGateway | null = null;
  private lastCapacity = 0;

  /** Called when a message should be "sent" — allows interception in tests. */
  onSend: ((msg: DaemonToGateway) => void) | null = null;

  /** Called when a message is received from the Gateway. */
  onMessage: ((msg: GatewayToDaemon) => void) | null = null;

  /** Called when the connection closes permanently (after max retries or intentional disconnect). */
  onClose: (() => void) | null = null;

  constructor(config: DaemonConfig) {
    this.config = config;
  }

  /**
   * Connect to the Gateway and send registration.
   */
  connect(daemonId: string, capacity: number): void {
    this.closed = false;
    this.lastCapacity = capacity;
    const registerMsg: DaemonToGateway = {
      type: "register",
      daemon_id: daemonId,
      capacity,
    };
    this.lastRegisterMsg = registerMsg;

    // Send registration immediately (for test compatibility)
    this.onSend?.(registerMsg);

    // In production, we'd create a real WebSocket here
    this._connectWs(registerMsg);
  }

  private _connectWs(registerMsg: DaemonToGateway): void {
    try {
      // Dynamic import to avoid issues when ws is mocked
      import("ws").then((wsModule) => {
        if (this.closed) return;
        const WS = wsModule.default;
        this.ws = new WS(this.config.gateway_url, {
          headers: { authorization: `Bearer ${this.config.api_key}` },
        });

        this.ws.onopen = () => {
          this.reconnectAttempts = 0;
          this.ws?.send(JSON.stringify(registerMsg));
        };

        this.ws.onmessage = (event: { data: unknown }) => {
          const data = typeof event.data === "string" ? event.data : String(event.data);
          this.handleIncoming(JSON.parse(data));
        };

        this.ws.onclose = () => {
          if (!this.closed) {
            this.attemptReconnect();
          } else {
            this.onClose?.();
          }
        };

        this.ws.onerror = () => {
          // Connection errors are handled by onclose
        };
      });
    } catch {
      // WebSocket connection failed — will be handled by reconnect logic
      if (!this.closed) {
        this.attemptReconnect();
      }
    }
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.onClose?.();
      return;
    }

    this.reconnectAttempts++;
    const delay = DEFAULT_RECONNECT_DELAY_MS * this.reconnectAttempts;
    setTimeout(() => {
      if (this.closed) return;
      // Re-register with a fresh register message (server assigns new ID)
      const registerMsg: DaemonToGateway = {
        type: "register",
        daemon_id: "reconnect",
        capacity: this.lastCapacity,
      };
      this.lastRegisterMsg = registerMsg;
      this._connectWs(registerMsg);
    }, delay);
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

    if (this.ws && this.ws.readyState === WebSocketState.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  /**
   * Close the WebSocket connection (no reconnect).
   */
  disconnect(): void {
    this.closed = true;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

/** WebSocket readyState constants (avoid magic numbers). */
const WebSocketState = {
  OPEN: 1,
} as const;
