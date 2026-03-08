import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AttaGoClient, McpError } from '../../src/index.js';

// ── Helpers ─────────────────────────────────────────────────────────

interface FetchCall {
  url: string;
  init: RequestInit;
}

function mockFetch(status: number, body: unknown) {
  const calls: FetchCall[] = [];
  const fn = async (
    url: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    calls.push({ url: url.toString(), init: init ?? {} });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  return { fn: fn as typeof globalThis.fetch, calls };
}

/** Parse the JSON-RPC request body from a fetch call. */
function parseRpcBody(call: FetchCall): Record<string, unknown> {
  return JSON.parse(call.init.body as string);
}

// ── Tests ───────────────────────────────────────────────────────────

describe('McpModule', () => {
  describe('initialize', () => {
    it('should POST /v1/mcp with initialize method', async () => {
      const rpcResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: {
          protocolVersion: '2025-03-26',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'attago-mcp', version: '1.0.0' },
          instructions: 'AttaGo provides crypto signals.',
        },
      };
      const { fn, calls } = mockFetch(200, rpcResponse);
      const client = new AttaGoClient({ apiKey: 'ak_live_abc', fetch: fn });

      const result = await client.mcp.initialize();

      assert.equal(calls.length, 1);
      assert.ok(calls[0]!.url.endsWith('/v1/mcp'));
      assert.equal(calls[0]!.init.method, 'POST');

      const body = parseRpcBody(calls[0]!);
      assert.equal(body.jsonrpc, '2.0');
      assert.equal(body.method, 'initialize');
      assert.deepEqual((body.params as Record<string, unknown>).protocolVersion, '2025-03-26');
      assert.equal(typeof body.id, 'number');

      assert.equal(result.protocolVersion, '2025-03-26');
      assert.equal(result.serverInfo.name, 'attago-mcp');
    });
  });

  describe('listTools', () => {
    it('should return tool definitions with pricing annotations', async () => {
      const rpcResponse = {
        jsonrpc: '2.0',
        id: 2,
        result: {
          tools: [
            {
              name: 'get_asset_score',
              description: 'Get full trading data',
              inputSchema: { type: 'object', properties: { symbol: { type: 'string' } } },
              annotations: { 'x-x402-price-usd': 0.10, 'x-x402-asset': 'USDC' },
            },
            {
              name: 'list_assets',
              description: 'List all tracked assets',
              inputSchema: { type: 'object', properties: {} },
            },
          ],
        },
      };
      const { fn } = mockFetch(200, rpcResponse);
      const client = new AttaGoClient({ apiKey: 'ak_live_abc', fetch: fn });

      const tools = await client.mcp.listTools();

      assert.equal(tools.length, 2);
      assert.equal(tools[0]!.name, 'get_asset_score');
      assert.equal(tools[0]!.annotations?.['x-x402-price-usd'], 0.10);
      assert.equal(tools[1]!.name, 'list_assets');
    });
  });

  describe('callTool', () => {
    it('should send tool call with arguments', async () => {
      const rpcResponse = {
        jsonrpc: '2.0',
        id: 3,
        result: {
          content: [{ type: 'text', text: '{"token":"BTC","data":{}}' }],
          isError: false,
        },
      };
      const { fn, calls } = mockFetch(200, rpcResponse);
      const client = new AttaGoClient({ apiKey: 'ak_live_abc', fetch: fn });

      const result = await client.mcp.callTool('get_asset_score', { symbol: 'BTC' });

      const body = parseRpcBody(calls[0]!);
      assert.equal(body.method, 'tools/call');
      assert.deepEqual((body.params as Record<string, unknown>).name, 'get_asset_score');
      assert.deepEqual(
        (body.params as Record<string, unknown>).arguments,
        { symbol: 'BTC' },
      );

      assert.equal(result.isError, false);
      assert.equal(result.content.length, 1);
      assert.equal(result.content[0]!.type, 'text');
      assert.ok(result.content[0]!.text?.includes('BTC'));
    });

    it('should return tool error result', async () => {
      const rpcResponse = {
        jsonrpc: '2.0',
        id: 4,
        result: {
          content: [{ type: 'text', text: '{"error":"Unknown asset: NOTREAL"}' }],
          isError: true,
        },
      };
      const { fn } = mockFetch(200, rpcResponse);
      const client = new AttaGoClient({ apiKey: 'ak_live_abc', fetch: fn });

      const result = await client.mcp.callTool('get_asset_score', { symbol: 'NOTREAL' });

      assert.equal(result.isError, true);
    });

    it('should default to empty arguments', async () => {
      const rpcResponse = {
        jsonrpc: '2.0',
        id: 5,
        result: {
          content: [{ type: 'text', text: '{"index":65}' }],
          isError: false,
        },
      };
      const { fn, calls } = mockFetch(200, rpcResponse);
      const client = new AttaGoClient({ apiKey: 'ak_live_abc', fetch: fn });

      await client.mcp.callTool('get_fear_greed');

      const body = parseRpcBody(calls[0]!);
      assert.deepEqual(
        (body.params as Record<string, unknown>).arguments,
        {},
      );
    });
  });

  describe('ping', () => {
    it('should send ping method', async () => {
      const rpcResponse = { jsonrpc: '2.0', id: 6, result: {} };
      const { fn, calls } = mockFetch(200, rpcResponse);
      const client = new AttaGoClient({ apiKey: 'ak_live_abc', fetch: fn });

      await client.mcp.ping();

      const body = parseRpcBody(calls[0]!);
      assert.equal(body.method, 'ping');
    });
  });

  describe('error handling', () => {
    it('should throw McpError on JSON-RPC error', async () => {
      const rpcResponse = {
        jsonrpc: '2.0',
        id: 7,
        error: { code: -32601, message: 'Method not found: foo' },
      };
      const { fn } = mockFetch(200, rpcResponse);
      const client = new AttaGoClient({ apiKey: 'ak_live_abc', fetch: fn });

      await assert.rejects(
        () => client.mcp.callTool('foo'),
        (err: unknown) => {
          assert.ok(err instanceof McpError);
          assert.equal(err.code, -32601);
          assert.ok(err.message.includes('Method not found'));
          return true;
        },
      );
    });

    it('should throw McpError on HTTP error', async () => {
      const { fn } = mockFetch(500, { error: 'Internal error' });
      const client = new AttaGoClient({ apiKey: 'ak_live_abc', fetch: fn });

      await assert.rejects(
        () => client.mcp.callTool('get_asset_score', { symbol: 'BTC' }),
        (err: unknown) => {
          assert.ok(err instanceof McpError);
          assert.equal(err.code, 500);
          return true;
        },
      );
    });
  });

  describe('request ID auto-increment', () => {
    it('should increment request IDs across calls', async () => {
      const rpcResponse = { jsonrpc: '2.0', id: 0, result: {} };
      const { fn, calls } = mockFetch(200, rpcResponse);
      const client = new AttaGoClient({ apiKey: 'ak_live_abc', fetch: fn });

      await client.mcp.ping();
      await client.mcp.ping();
      await client.mcp.ping();

      const ids = calls.map((c) => parseRpcBody(c).id);
      assert.deepEqual(ids, [1, 2, 3]);
    });
  });

  describe('auth headers', () => {
    it('should include X-API-Key for apikey mode', async () => {
      const rpcResponse = { jsonrpc: '2.0', id: 1, result: {} };
      const { fn, calls } = mockFetch(200, rpcResponse);
      const client = new AttaGoClient({ apiKey: 'ak_live_mykey', fetch: fn });

      await client.mcp.ping();

      const headers = calls[0]!.init.headers as Record<string, string>;
      assert.equal(headers['X-API-Key'], 'ak_live_mykey');
    });

    it('should not include auth header for none mode', async () => {
      const rpcResponse = { jsonrpc: '2.0', id: 1, result: {} };
      const { fn, calls } = mockFetch(200, rpcResponse);
      const client = new AttaGoClient({ fetch: fn });

      await client.mcp.ping();

      const headers = calls[0]!.init.headers as Record<string, string>;
      assert.equal(headers['X-API-Key'], undefined);
      assert.equal(headers['Authorization'], undefined);
    });
  });
});
