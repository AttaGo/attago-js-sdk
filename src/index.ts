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
 * const client = new AttaGoClient({ apiKey: 'ak_live_abc123' });
 * const score = await client.request('GET', '/agent/score', { query: { symbol: 'BTC' } });
 * ```
 *
 * @packageDocumentation
 */

import { CognitoAuth } from './auth.js';
import { ApiError, PaymentRequiredError, RateLimitError } from './errors.js';
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

export const VERSION = '0.1.0';

// ── Re-exports ──────────────────────────────────────────────────────

export { CognitoAuth } from './auth.js';
export {
  AttaGoError,
  ApiError,
  PaymentRequiredError,
  RateLimitError,
  AuthError,
  MfaRequiredError,
} from './errors.js';
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

// ── Client ──────────────────────────────────────────────────────────

/**
 * AttaGo API client.
 *
 * Provides authenticated HTTP requests to the AttaGo API. Namespace modules
 * (e.g. `client.agent`, `client.subscriptions`) are attached in later tasks.
 */
export class AttaGoClient {
  /** Resolved API base URL (no trailing slash). */
  readonly baseUrl: string;

  /** Which authentication mode is active. */
  readonly authMode: AuthMode;

  /**
   * Cognito auth manager — only available in `cognito` mode.
   *
   * Use for explicit sign-in, MFA, sign-out, and token persistence.
   */
  readonly auth: CognitoAuth | null;

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
   *
   * @typeParam T — Expected response body type.
   * @param method — HTTP method (`GET`, `POST`, `PUT`, `DELETE`).
   * @param path — API path (e.g. `'/user/profile'`).
   * @param options — Body, headers, query params.
   * @returns Parsed JSON response body.
   *
   * @throws {PaymentRequiredError} on 402 — x402 payment needed.
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
    // x402 mode: no auth header — payment handling added in Task 2.3

    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    // ── Execute ──
    const res = await this._fetch(url.toString(), {
      method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });

    if (!res.ok) {
      return this._handleError(res) as never;
    }

    // ── Parse response ──
    const contentType = res.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      return (await res.json()) as T;
    }

    // 204 No Content or non-JSON success
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
