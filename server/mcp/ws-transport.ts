/**
 * WebSocket Transport for MCP
 *
 * Lightweight, self-contained implementation of the MCP transport layer
 * using WebSocket for both server-side (`ws` package) and browser environments.
 */

import type { WebSocket as WsWebSocket } from "ws";

/**
 * Server-side transport wrapping a `ws` WebSocket.
 */
export class WebSocketServerTransport {
  private _ws: WsWebSocket;
  private _messageHandler?: (message: string) => void;
  private _closeHandler?: () => void;
  private _errorHandler?: (error: Error) => void;

  constructor(ws: WsWebSocket) {
    this._ws = ws;

    ws.on("message", (raw: Buffer | string) => {
      const msg = raw.toString();
      this._messageHandler?.(msg);
    });

    ws.on("close", () => {
      this._closeHandler?.();
    });

    ws.on("error", (err: Error) => {
      this._errorHandler?.(err);
    });
  }

  onMessage(handler: (message: string) => void) {
    this._messageHandler = handler;
  }

  onClose(handler: () => void) {
    this._closeHandler = handler;
  }

  onError(handler: (error: Error) => void) {
    this._errorHandler = handler;
  }

  send(message: Record<string, unknown>): void {
    this._ws.send(JSON.stringify(message));
  }

  close(): void {
    this._ws.close();
  }
}

/**
 * Browser-side transport wrapping the native browser WebSocket.
 * NOT intended for use on the server — use WebSocketServerTransport instead.
 */
export class BrowserWebSocketTransport {
  private _ws: globalThis.WebSocket | null = null;
  private _url: string;
  private _connected = false;
  private _pending: Record<string, unknown>[] = [];
  private _messageHandler?: (message: string) => void;
  private _closeHandler?: () => void;

  constructor(url: string) {
    this._url = url;
  }

  onMessage(handler: (message: string) => void) {
    this._messageHandler = handler;
  }

  onClose(handler: () => void) {
    this._closeHandler = handler;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this._ws = new globalThis.WebSocket(this._url);

        this._ws.onopen = () => {
          this._connected = true;
          for (const msg of this._pending) {
            this._ws?.send(JSON.stringify(msg));
          }
          this._pending = [];
          resolve();
        };

        this._ws.onmessage = (event: globalThis.MessageEvent) => {
          this._messageHandler?.(String(event.data));
        };

        this._ws.onclose = () => {
          this._connected = false;
          this._closeHandler?.();
        };

        this._ws.onerror = () => {
          reject(new Error("WebSocket connection failed"));
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  send(message: Record<string, unknown>): void {
    if (this._ws && this._connected) {
      this._ws.send(JSON.stringify(message));
    } else {
      this._pending.push(message);
    }
  }

  close(): void {
    this._ws?.close();
    this._ws = null;
    this._connected = false;
  }

  get connected(): boolean {
    return this._connected;
  }
}
