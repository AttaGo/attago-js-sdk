/**
 * MCP client module — Model Context Protocol (JSON-RPC 2.0) over Streamable HTTP.
 *
 * Stateless HTTP transport — each request is independent.
 * Paid tools (get_asset_score, get_market_data) require x402 payment.
 *
 * - `initialize()` — negotiate protocol version
 * - `listTools()` — discover available tools + pricing
 * - `callTool(name, args)` — execute a tool
 * - `ping()` — health check
 */

import type { AttaGoClient } from './index.js';
import { AttaGoError } from './errors.js';

// ── Types ───────────────────────────────────────────────────────────

/** JSON-RPC 2.0 request. */
interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

/** JSON-RPC 2.0 response (success). */
interface JsonRpcResponse<T = unknown> {
  jsonrpc: '2.0';
  id: number;
  result?: T;
  error?: JsonRpcError;
}

/** JSON-RPC 2.0 error. */
export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

/** MCP server capabilities from initialize. */
export interface McpServerInfo {
  protocolVersion: string;
  capabilities: {
    tools?: { listChanged: boolean };
  };
  serverInfo: {
    name: string;
    version: string;
  };
  instructions?: string;
}

/** MCP tool definition. */
export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: {
    'x-x402-price-usd'?: number;
    'x-x402-asset'?: string;
    [key: string]: unknown;
  };
}

/** Result of listing tools. */
export interface McpToolListResult {
  tools: McpTool[];
}

/** Content item in a tool result. */
export interface McpToolContent {
  type: 'text' | 'image' | 'resource';
  text?: string;
  data?: string;
  mimeType?: string;
}

/** Result of calling a tool. */
export interface McpToolCallResult {
  content: McpToolContent[];
  isError: boolean;
}

/** Custom error for MCP JSON-RPC errors. */
export class McpError extends AttaGoError {
  readonly code: number;
  readonly data: unknown;

  constructor(error: JsonRpcError) {
    super(error.message);
    this.name = 'McpError';
    this.code = error.code;
    this.data = error.data;
  }
}

// ── Module ──────────────────────────────────────────────────────────

export class McpModule {
  private _nextId = 1;

  /** @internal */
  constructor(
    private readonly _client: AttaGoClient,
    private readonly _fetch: typeof globalThis.fetch,
  ) {}

  /**
   * Negotiate protocol version with the MCP server.
   *
   * Free — no payment required.
   *
   * @returns Server info, capabilities, and instructions.
   */
  async initialize(): Promise<McpServerInfo> {
    return this._rpc<McpServerInfo>('initialize', {
      protocolVersion: '2025-03-26',
    });
  }

  /**
   * Discover available tools and their schemas.
   *
   * Free — no payment required.
   * Each tool includes pricing annotations for paid tools.
   *
   * @returns Array of tool definitions with input schemas and pricing.
   */
  async listTools(): Promise<McpTool[]> {
    const result = await this._rpc<McpToolListResult>('tools/list');
    return result.tools;
  }

  /**
   * Execute an MCP tool.
   *
   * Free tools (get_fear_greed, list_assets) work without payment.
   * Paid tools (get_asset_score, get_market_data) return payment requirements
   * on first call — in x402 signer mode, the SDK auto-handles payment.
   *
   * @param name — Tool name (e.g. `'get_asset_score'`).
   * @param args — Tool arguments (e.g. `{ symbol: 'BTC' }`).
   * @returns Tool result with content and error status.
   * @throws {McpError} on JSON-RPC errors (-32700, -32601, -32602).
   */
  async callTool(
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<McpToolCallResult> {
    return this._rpc<McpToolCallResult>('tools/call', {
      name,
      arguments: args,
    });
  }

  /**
   * Health check — ping the MCP server.
   */
  async ping(): Promise<void> {
    await this._rpc<Record<string, never>>('ping');
  }

  // ── Internals ───────────────────────────────────────────────────

  /**
   * Send a JSON-RPC 2.0 request to the MCP endpoint.
   *
   * Uses the client's auth mode for the underlying HTTP request.
   * In x402 mode, 402 responses are auto-handled by the client's
   * fetchWithX402 wrapper.
   */
  private async _rpc<T>(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<T> {
    const requestId = this._nextId++;

    const rpcRequest: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: requestId,
      method,
    };

    if (params) {
      rpcRequest.params = params;
    }

    // Use the client's request infrastructure for auth,
    // but we need raw JSON-RPC handling (not the client's auto-parse).
    const baseUrl = this._client.baseUrl;
    const url = `${baseUrl}/v1/mcp`;

    // Build auth headers via the client's shared helper (no unsafe casts)
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    const authHeaders = await this._client._buildAuthHeaders();
    Object.assign(headers, authHeaders);

    const init: RequestInit = {
      method: 'POST',
      headers,
      body: JSON.stringify(rpcRequest),
    };

    // Use fetchWithX402 for signer mode (auto-handles paid tools)
    let res: Response;
    if (this._client.authMode === 'x402' && this._client._signer) {
      const { fetchWithX402 } = await import('./x402.js');
      res = await fetchWithX402(this._fetch, this._client._signer, url, init);
    } else {
      res = await this._fetch(url, init);
    }

    if (!res.ok) {
      const body = await res.text();
      throw new McpError({
        code: res.status,
        message: `HTTP ${res.status}: ${body}`,
      });
    }

    const json = (await res.json()) as JsonRpcResponse<T>;

    if (json.error) {
      throw new McpError(json.error);
    }

    return json.result as T;
  }
}
