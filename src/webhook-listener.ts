/**
 * Webhook listener — local HTTP server for receiving AttaGo webhook deliveries.
 *
 * Verifies `X-AttaGo-Signature` (HMAC-SHA256), parses v2 payloads,
 * and emits typed events. Returns 200 on valid, 401 on invalid signature.
 *
 * No tunnel/ngrok, no TLS, no auto-registration. Designed for local dev
 * and CI environments behind a reverse proxy in production.
 *
 * @example
 * ```ts
 * import { WebhookListener } from '@attago/sdk';
 *
 * const listener = new WebhookListener({
 *   secret: 'wh_secret_from_creation',
 *   port: 4000,
 * });
 *
 * listener.on('alert', (payload) => {
 *   console.log(`${payload.alert.token} → ${payload.alert.state}`);
 * });
 *
 * listener.on('test', (payload) => {
 *   console.log('Test delivery received!');
 * });
 *
 * await listener.start();
 * // ...
 * await listener.stop();
 * ```
 */

import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { verifySignature } from './webhooks.js';

// ── Types ───────────────────────────────────────────────────────────

/** v2 webhook payload (alert or test). */
export interface WebhookPayload {
  event: 'alert' | 'test';
  version: string;
  environment: string;
  alert: {
    id: string;
    label: string;
    token: string;
    state: 'triggered' | 'resolved';
  };
  data: {
    url: string | null;
    expiresAt?: string;
    fallbackUrl?: string;
  };
  timestamp: string;
}

/** Listener configuration. */
export interface WebhookListenerOptions {
  /** HMAC signing secret (from webhook creation response). */
  secret: string;
  /** Port to listen on. @defaultValue 4000 */
  port?: number;
  /** Host to bind to. @defaultValue '0.0.0.0' */
  host?: string;
  /** HTTP path to accept webhooks on. @defaultValue '/webhook' */
  path?: string;
  /** Maximum request body size in bytes. @defaultValue 1_048_576 (1 MB) */
  maxBodySize?: number;
}

/** Event types emitted by the listener. */
export interface WebhookListenerEvents {
  alert: (payload: WebhookPayload) => void;
  test: (payload: WebhookPayload) => void;
  error: (error: Error) => void;
}

type EventName = keyof WebhookListenerEvents;

// ── Listener ────────────────────────────────────────────────────────

export class WebhookListener {
  readonly port: number;
  readonly host: string;
  readonly path: string;
  private readonly _secret: string;
  private readonly _maxBodySize: number;
  private _server: Server | null = null;
  private readonly _handlers: {
    [K in EventName]: Array<WebhookListenerEvents[K]>;
  } = {
    alert: [],
    test: [],
    error: [],
  };

  constructor(options: WebhookListenerOptions) {
    this._secret = options.secret;
    this.port = options.port ?? 4000;
    this.host = options.host ?? '0.0.0.0';
    this.path = options.path ?? '/webhook';
    this._maxBodySize = options.maxBodySize ?? 1_048_576; // 1 MB
  }

  /**
   * Register an event handler.
   *
   * @param event — `'alert'` for real alerts, `'test'` for test deliveries, `'error'` for errors.
   */
  on<K extends EventName>(
    event: K,
    handler: WebhookListenerEvents[K],
  ): this {
    this._handlers[event].push(handler);
    return this;
  }

  /**
   * Remove an event handler.
   */
  off<K extends EventName>(
    event: K,
    handler: WebhookListenerEvents[K],
  ): this {
    const list = this._handlers[event] as unknown[];
    const idx = list.indexOf(handler);
    if (idx !== -1) list.splice(idx, 1);
    return this;
  }

  /**
   * Start the HTTP server and begin listening for webhooks.
   *
   * @returns Promise that resolves when the server is ready.
   */
  async start(): Promise<void> {
    if (this._server) {
      throw new Error('Listener already started');
    }

    return new Promise<void>((resolve) => {
      this._server = createServer((req, res) => this._handleRequest(req, res));
      this._server.listen(this.port, this.host, () => resolve());
    });
  }

  /**
   * Stop the HTTP server.
   *
   * @returns Promise that resolves when the server has closed.
   */
  async stop(): Promise<void> {
    if (!this._server) return;

    return new Promise<void>((resolve, reject) => {
      this._server!.close((err) => {
        this._server = null;
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /** Whether the server is currently running. */
  get listening(): boolean {
    return this._server !== null && this._server.listening;
  }

  /**
   * The actual port the server is bound to.
   *
   * Useful when constructed with `port: 0` (OS-assigned).
   * Falls back to the configured port if the server is not yet listening.
   */
  get actualPort(): number {
    const addr = this._server?.address();
    if (addr && typeof addr === 'object') {
      return addr.port;
    }
    return this.port;
  }

  // ── Internals ───────────────────────────────────────────────────

  /** @internal */
  private _handleRequest(req: IncomingMessage, res: ServerResponse): void {
    // Only accept POST to the configured path
    if (req.method !== 'POST' || req.url !== this.path) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    const chunks: Buffer[] = [];
    let totalSize = 0;
    let destroyed = false;
    req.on('data', (chunk: Buffer) => {
      totalSize += chunk.length;
      if (totalSize > this._maxBodySize) {
        destroyed = true;
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Payload too large' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (destroyed) return;
      try {
        const rawBody = Buffer.concat(chunks);
        const signature = req.headers['x-attago-signature'] as string | undefined;

        // ── Verify signature ──
        if (!signature || !verifySignature(rawBody, this._secret, signature)) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid signature' }));
          return;
        }

        // ── Parse payload ──
        const payload = JSON.parse(rawBody.toString('utf-8')) as WebhookPayload;

        // ── Emit event ──
        const eventType = payload.event === 'test' ? 'test' : 'alert';
        for (const handler of this._handlers[eventType]) {
          try {
            (handler as (p: WebhookPayload) => void)(payload);
          } catch (err) {
            this._emit('error', err instanceof Error ? err : new Error(String(err)));
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ received: true }));
      } catch (err) {
        this._emit('error', err instanceof Error ? err : new Error(String(err)));
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid payload' }));
      }
    });
  }

  /** @internal */
  private _emit(event: 'error', ...args: Parameters<WebhookListenerEvents['error']>): void {
    for (const handler of this._handlers[event]) {
      try {
        handler(...args);
      } catch {
        // Swallow errors in error handlers to prevent infinite recursion
      }
    }
  }
}
