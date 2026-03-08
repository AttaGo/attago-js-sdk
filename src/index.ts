/**
 * @attago/sdk — TypeScript SDK for the AttaGo crypto trading dashboard API.
 *
 * Three authentication modes:
 * - **API key**: `new AttaGoClient({ apiKey: 'ak_live_...' })`
 * - **x402 signer**: `new AttaGoClient({ signer: walletSigner })`
 * - **Cognito**: `new AttaGoClient({ email, password, cognitoClientId })`
 *
 * @example
 * ```ts
 * import { AttaGoClient } from '@attago/sdk';
 *
 * const client = new AttaGoClient({ apiKey: 'ak_live_abc123' });
 * const score = await client.agent.getScore('BTC');
 * console.log(score.composite.signal); // 'GO' | 'NO-GO' | 'NEUTRAL'
 * ```
 *
 * @packageDocumentation
 */

import { AgentModule } from './agent.js';
import { ApiKeysModule } from './api-keys.js';
import { CognitoAuth } from './auth.js';
import { BundlesModule } from './bundles.js';
import { DataModule } from './data.js';
import { ApiError, PaymentRequiredError, RateLimitError } from './errors.js';
import { McpModule } from './mcp.js';
import { PaymentsModule } from './payments.js';
import { PushModule } from './push.js';
import { RedeemModule } from './redeem.js';
import { SubscriptionsModule } from './subscriptions.js';
import {
  DEFAULT_BASE_URL,
  DEFAULT_COGNITO_REGION,
  type AuthMode,
  type ClientOptions,
  type ConfirmForgotPasswordOptions,
  type ConfirmSignUpOptions,
  type ForgotPasswordOptions,
  type RequestOptions,
  type SignUpOptions,
  type X402Signer,
} from './types.js';
import { WalletsModule } from './wallets.js';
import { WebhooksModule } from './webhooks.js';
import { fetchWithX402 } from './x402.js';

export const VERSION = '0.1.0';

// ── Re-exports ──────────────────────────────────────────────────────

export { AgentModule, type AgentScoreResponse, type AgentDataResponse } from './agent.js';
export {
  ApiKeysModule,
  type ApiKeyCreateResponse,
  type ApiKeyListItem,
} from './api-keys.js';
export { CognitoAuth } from './auth.js';
export {
  BundlesModule,
  type Bundle,
  type BundleCatalogEntry,
  type BundleListResponse,
  type BundlePurchaseResponse,
  type PurchaseBundleOptions,
} from './bundles.js';
export { DataModule, type DataLatestResponse, type DataTokenResponse, type DataPushResponse } from './data.js';
export {
  McpModule,
  McpError,
  type McpTool,
  type McpToolCallResult,
  type McpToolContent,
  type McpToolListResult,
  type McpServerInfo,
  type JsonRpcError,
} from './mcp.js';
export {
  AttaGoError,
  ApiError,
  PaymentRequiredError,
  RateLimitError,
  AuthError,
  MfaRequiredError,
} from './errors.js';
export {
  PaymentsModule,
  type BillingTier,
  type BillingCycle,
  type SubscribeOptions,
  type SubscribeResponse,
  type BillingStatus,
  type UpgradeQuote,
  type IncludedPushes,
} from './payments.js';
export {
  PushModule,
  type CreatePushOptions,
  type PushSubscription,
  type PushKeys,
} from './push.js';
export {
  RedeemModule,
  type RedeemResponse,
} from './redeem.js';
export {
  SubscriptionsModule,
  type Subscription,
  type SubscriptionCondition,
  type CatalogResponse,
  type CatalogMetric,
  type CreateSubscriptionOptions,
  type UpdateSubscriptionOptions,
} from './subscriptions.js';
export type {
  AuthMode,
  ClientOptions,
  CognitoTokens,
  ConfirmForgotPasswordOptions,
  ConfirmSignUpOptions,
  ForgotPasswordOptions,
  RequestOptions,
  SignUpOptions,
  X402AcceptedPayment,
  X402PaymentRequirements,
  X402Signer,
} from './types.js';
export {
  WalletsModule,
  type Wallet,
  type WalletChain,
  type RegisterWalletOptions,
} from './wallets.js';
export {
  WebhooksModule,
  buildTestPayload,
  signPayload,
  verifySignature,
  type WebhookCreateResponse,
  type WebhookListItem,
  type WebhookTestResult,
  type SendTestOptions,
} from './webhooks.js';
export {
  parsePaymentRequired,
  filterAcceptsByNetwork,
} from './x402.js';

// ── Client ──────────────────────────────────────────────────────────

/**
 * AttaGo API client.
 *
 * Provides authenticated HTTP requests to the AttaGo API with
 * namespace modules for each endpoint group.
 */
export class AttaGoClient {
  /** Resolved API base URL (no trailing slash). */
  readonly baseUrl: string;

  /** Which authentication mode is active. */
  readonly authMode: AuthMode;

  /**
   * Cognito auth manager — only available in `cognito` mode.
   * Use for explicit sign-in, MFA, sign-out, and token persistence.
   */
  readonly auth: CognitoAuth | null;

  /** Agent endpoints — Go/No-Go scores and full market data. */
  readonly agent: AgentModule;

  /** API key management — create, list, revoke. */
  readonly apiKeys: ApiKeysModule;

  /** Prepaid data-push credit bundles. */
  readonly bundles: BundlesModule;

  /** Data access — latest, per-token, and 72h snapshots. */
  readonly data: DataModule;

  /** MCP (Model Context Protocol) client — JSON-RPC 2.0 tool calls. */
  readonly mcp: McpModule;

  /** Subscription billing — subscribe, status, upgrade quotes. */
  readonly payments: PaymentsModule;

  /** Web Push notification subscriptions. */
  readonly push: PushModule;

  /** Redemption code activation. */
  readonly redeem: RedeemModule;

  /** Alert subscription configuration — catalog, CRUD. */
  readonly subscriptions: SubscriptionsModule;

  /** Verified wallet management — register, list, remove. */
  readonly wallets: WalletsModule;

  /** Webhook management — CRUD, SDK-side and server-side test delivery. */
  readonly webhooks: WebhooksModule;

  /** @internal */ readonly _signer: X402Signer | null;
  private readonly _apiKey: string | null;
  private readonly _fetch: typeof globalThis.fetch;

  constructor(options: ClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this._fetch = options.fetch ?? globalThis.fetch.bind(globalThis);

    // ── Determine auth mode ──
    const hasApiKey = !!options.apiKey;
    const hasSigner = !!options.signer;
    const hasCognito = !!(options.email || options.cognitoClientId);

    const modes = [
      hasApiKey && 'apikey',
      hasSigner && 'x402',
      hasCognito && 'cognito',
    ].filter(Boolean) as AuthMode[];

    if (modes.length > 1) {
      throw new Error(
        `Only one auth mode allowed. Got: ${modes.join(', ')}. ` +
          'Use apiKey, signer, OR email/cognitoClientId — not multiple.',
      );
    }

    this.authMode = modes[0] ?? 'none';
    this._apiKey = options.apiKey ?? null;
    this._signer = options.signer ?? null;

    // ── Set up Cognito auth ──
    if (this.authMode === 'cognito') {
      if (!options.cognitoClientId) {
        throw new Error(
          'cognitoClientId is required for Cognito authentication.',
        );
      }
      this.auth = new CognitoAuth(
        options.cognitoClientId,
        options.cognitoRegion ?? DEFAULT_COGNITO_REGION,
        this._fetch,
        options.email,
        options.password,
      );
    } else {
      this.auth = null;
    }

    // ── Attach namespace modules ──
    this.agent = new AgentModule(this);
    this.apiKeys = new ApiKeysModule(this);
    this.bundles = new BundlesModule(this);
    this.data = new DataModule(this);
    this.mcp = new McpModule(this, this._fetch);
    this.payments = new PaymentsModule(this);
    this.push = new PushModule(this);
    this.redeem = new RedeemModule(this);
    this.subscriptions = new SubscriptionsModule(this);
    this.wallets = new WalletsModule(this);
    this.webhooks = new WebhooksModule(this, this._fetch);
  }

  // ── Static registration helpers ──────────────────────────────────

  /** Create a new account. Sends a verification code to the email. */
  static async signUp(opts: SignUpOptions): Promise<{ userSub: string }> {
    return CognitoAuth.signUp(opts);
  }

  /** Confirm a new account with the emailed verification code. */
  static async confirmSignUp(opts: ConfirmSignUpOptions): Promise<void> {
    return CognitoAuth.confirmSignUp(opts);
  }

  /** Trigger a password-reset email. */
  static async forgotPassword(opts: ForgotPasswordOptions): Promise<void> {
    return CognitoAuth.forgotPassword(opts);
  }

  /** Complete a password reset with the emailed code + new password. */
  static async confirmForgotPassword(
    opts: ConfirmForgotPasswordOptions,
  ): Promise<void> {
    return CognitoAuth.confirmForgotPassword(opts);
  }

  // ── HTTP request ─────────────────────────────────────────────────

  /**
   * Make an authenticated API request.
   *
   * The `/v1` prefix is added automatically if not already present.
   * In x402 signer mode, 402 responses are auto-signed and retried.
   *
   * @typeParam T — Expected response body type.
   * @param method — HTTP method (`GET`, `POST`, `PUT`, `DELETE`).
   * @param path — API path (e.g. `'/user/profile'`).
   * @param options — Body, headers, query params.
   * @returns Parsed JSON response body.
   *
   * @throws {PaymentRequiredError} on 402 — x402 payment needed (or signer failed).
   * @throws {RateLimitError} on 429 — rate limit or abuse ban.
   * @throws {ApiError} on other 4xx/5xx responses.
   */
  async request<T = unknown>(
    method: string,
    path: string,
    options: RequestOptions = {},
  ): Promise<T> {
    // ── Build URL ──
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const fullPath = normalizedPath.startsWith('/v1/')
      ? normalizedPath
      : `/v1${normalizedPath}`;

    const url = new URL(`${this.baseUrl}${fullPath}`);

    if (options.query) {
      for (const [key, value] of Object.entries(options.query)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    // ── Build headers ──
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...options.headers,
    };

    if (this.authMode === 'apikey' && this._apiKey) {
      headers['X-API-Key'] = this._apiKey;
    } else if (this.authMode === 'cognito' && this.auth) {
      const token = await this.auth.getIdToken();
      headers['Authorization'] = `Bearer ${token}`;
    }
    // x402: no auth header — payment signature added by fetchWithX402

    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    // ── Execute (with x402 auto-retry for signer mode) ──
    const init: RequestInit = {
      method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    };

    const res =
      this.authMode === 'x402' && this._signer
        ? await fetchWithX402(this._fetch, this._signer, url.toString(), init)
        : await this._fetch(url.toString(), init);

    if (!res.ok) {
      return this._handleError(res) as never;
    }

    // ── Parse response ──
    if (res.status === 204) {
      return undefined as unknown as T;
    }

    const contentType = res.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      return (await res.json()) as T;
    }

    // Non-JSON success
    return undefined as unknown as T;
  }

  // ── Error handling ───────────────────────────────────────────────

  /** @internal */
  private async _handleError(res: Response): Promise<never> {
    let body: Record<string, unknown> = {};
    try {
      body = (await res.json()) as Record<string, unknown>;
    } catch {
      // Response might not be JSON
    }

    const message =
      (body.error as string | undefined) ??
      (body.message as string | undefined) ??
      `HTTP ${res.status}`;

    if (res.status === 402) {
      const paymentHeader = res.headers.get('payment-required');
      let paymentRequirements: unknown = null;
      if (paymentHeader) {
        try {
          paymentRequirements = JSON.parse(
            Buffer.from(paymentHeader, 'base64').toString('utf8'),
          );
        } catch {
          // Leave as null if base64/JSON parsing fails
        }
      }
      throw new PaymentRequiredError(
        message,
        res.headers,
        body,
        paymentRequirements,
      );
    }

    if (res.status === 429) {
      const retryAfter = res.headers.get('retry-after');
      throw new RateLimitError(
        message,
        res.headers,
        body,
        retryAfter ? parseInt(retryAfter, 10) : undefined,
      );
    }

    throw new ApiError(res.status, message, res.headers, body);
  }
}
