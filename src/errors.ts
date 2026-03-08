/**
 * Error classes for @attago/sdk.
 *
 * Hierarchy:
 *   AttaGoError
 *   ├── ApiError (HTTP 4xx/5xx)
 *   │   ├── PaymentRequiredError (402)
 *   │   └── RateLimitError (429)
 *   ├── AuthError (Cognito)
 *   │   └── MfaRequiredError
 *   └── (future: ValidationError, etc.)
 */

/** Base error for all AttaGo SDK errors. */
export class AttaGoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AttaGoError';
  }
}

/** HTTP API error returned by the AttaGo API. */
export class ApiError extends AttaGoError {
  constructor(
    /** HTTP status code. */
    public readonly status: number,
    /** Error message from the API response body. */
    message: string,
    /** Raw response headers (for x402 / rate-limit info). */
    public readonly headers?: Headers,
    /** Parsed response body. */
    public readonly body?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * 402 Payment Required — x402 payment needed.
 *
 * The `paymentRequirements` field contains the decoded PAYMENT-REQUIRED header
 * with accepted payment networks, amounts, and signing instructions.
 */
export class PaymentRequiredError extends ApiError {
  constructor(
    message: string,
    headers: Headers,
    body: Record<string, unknown>,
    /** Decoded x402 payment requirements (from PAYMENT-REQUIRED header). */
    public readonly paymentRequirements: unknown,
  ) {
    super(402, message, headers, body);
    this.name = 'PaymentRequiredError';
  }
}

/** 429 Too Many Requests — rate limit or abuse ban. */
export class RateLimitError extends ApiError {
  constructor(
    message: string,
    headers: Headers,
    body: Record<string, unknown>,
    /** Seconds until the ban expires (from `Retry-After` header). */
    public readonly retryAfter?: number,
  ) {
    super(429, message, headers, body);
    this.name = 'RateLimitError';
  }
}

/** Cognito authentication error. */
export class AuthError extends AttaGoError {
  constructor(
    message: string,
    /** Cognito error type (e.g. `"NotAuthorizedException"`). */
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

/**
 * MFA is required to complete sign-in.
 *
 * Call `client.auth.respondToMfa(error.session, totpCode)` to finish authentication.
 */
export class MfaRequiredError extends AuthError {
  constructor(
    /** Cognito session token — pass to `respondToMfa()`. */
    public readonly session: string,
    /** Challenge type (e.g. `"SOFTWARE_TOKEN_MFA"`). */
    public readonly challengeName: string,
  ) {
    super(
      `MFA required (${challengeName}). Call client.auth.respondToMfa() to complete sign-in.`,
    );
    this.name = 'MfaRequiredError';
  }
}
