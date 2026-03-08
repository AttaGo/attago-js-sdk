/**
 * Core types for @attago/sdk.
 *
 * Response-shape types (agent scores, subscriptions, etc.) are added in later tasks.
 * This file covers client options, auth, and internal request plumbing.
 *
 * @packageDocumentation
 */

// ── Constants ───────────────────────────────────────────────────────

/** Base URL for the AttaGo production API. */
export const DEFAULT_BASE_URL = 'https://api.attago.bid';

/** Default AWS region for Cognito. */
export const DEFAULT_COGNITO_REGION = 'us-east-1';

// ── x402 signer ─────────────────────────────────────────────────────

/**
 * x402 wallet signer for anonymous per-request payment.
 * Implementations handle EVM (EIP-712) or Solana (ed25519) signing.
 */
export interface X402Signer {
  /** Wallet address (0x-prefixed EVM or base58 Solana). */
  readonly address: string;
  /** Network identifier (e.g. `"eip155:8453"` for Base, `"solana:5eykt..."` for mainnet). */
  readonly network: string;
  /** Sign an x402 payment payload, returning a base64-encoded payment signature. */
  sign(paymentRequirements: X402PaymentRequirements): Promise<string>;
}

/** Decoded x402 payment requirements from the PAYMENT-REQUIRED header. */
export interface X402PaymentRequirements {
  x402Version: number;
  resource: { url: string; description: string; mimeType: string };
  accepts: X402AcceptedPayment[];
}

/** One accepted payment option from x402 requirements. */
export interface X402AcceptedPayment {
  scheme: string;
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;
}

// ── Client options ──────────────────────────────────────────────────

/** Options for constructing an {@link AttaGoClient}. */
export interface ClientOptions {
  /**
   * API base URL.
   * @defaultValue `"https://api.attago.bid"`
   */
  baseUrl?: string;

  // ── Auth mode 1: API key ──
  /** API key for programmatic access (e.g. `"ak_live_abc123..."`). */
  apiKey?: string;

  // ── Auth mode 2: x402 signer ──
  /** Wallet signer for x402 payment-authenticated requests. */
  signer?: X402Signer;

  // ── Auth mode 3: Cognito ──
  /** Email for Cognito authentication. */
  email?: string;
  /** Password for Cognito authentication. */
  password?: string;
  /** Cognito User Pool Client ID (required for Cognito auth). */
  cognitoClientId?: string;
  /**
   * AWS region for Cognito.
   * @defaultValue `"us-east-1"`
   */
  cognitoRegion?: string;

  // ── Advanced ──
  /** Custom fetch implementation for testing or proxying. */
  fetch?: typeof globalThis.fetch;
}

/** Auth mode determined from client options. */
export type AuthMode = 'apikey' | 'x402' | 'cognito' | 'none';

/** Options passed to the internal `request()` method. */
export interface RequestOptions {
  body?: unknown;
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean | undefined>;
}

// ── Cognito auth types ──────────────────────────────────────────────

/** Cognito token set for persistence/restoration. */
export interface CognitoTokens {
  idToken: string;
  accessToken: string;
  refreshToken: string;
}

/** Options for {@link AttaGoClient.signUp}. */
export interface SignUpOptions {
  email: string;
  password: string;
  cognitoClientId: string;
  cognitoRegion?: string;
  fetch?: typeof globalThis.fetch;
}

/** Options for {@link AttaGoClient.confirmSignUp}. */
export interface ConfirmSignUpOptions {
  email: string;
  code: string;
  cognitoClientId: string;
  cognitoRegion?: string;
  fetch?: typeof globalThis.fetch;
}

/** Options for {@link AttaGoClient.forgotPassword}. */
export interface ForgotPasswordOptions {
  email: string;
  cognitoClientId: string;
  cognitoRegion?: string;
  fetch?: typeof globalThis.fetch;
}

/** Options for {@link AttaGoClient.confirmForgotPassword}. */
export interface ConfirmForgotPasswordOptions {
  email: string;
  code: string;
  newPassword: string;
  cognitoClientId: string;
  cognitoRegion?: string;
  fetch?: typeof globalThis.fetch;
}
