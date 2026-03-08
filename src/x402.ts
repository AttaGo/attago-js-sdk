/**
 * x402 payment handling — auto-sign and retry on 402 Payment Required.
 *
 * When a request returns 402, the module:
 * 1. Decodes the PAYMENT-REQUIRED header
 * 2. Finds an accepted payment matching the signer's network
 * 3. Calls the signer to produce a PAYMENT-SIGNATURE
 * 4. Retries the original request with the signature header
 *
 * If no signer is configured, the 402 is thrown as-is (PaymentRequiredError).
 */

import { PaymentRequiredError } from './errors.js';
import type {
  X402Signer,
  X402PaymentRequirements,
  X402AcceptedPayment,
} from './types.js';

/**
 * Parse the base64-encoded PAYMENT-REQUIRED header into structured requirements.
 * Returns `null` if the header is missing or unparseable.
 */
export function parsePaymentRequired(
  headers: Headers,
): X402PaymentRequirements | null {
  const raw = headers.get('payment-required');
  if (!raw) return null;
  try {
    return JSON.parse(
      Buffer.from(raw, 'base64').toString('utf8'),
    ) as X402PaymentRequirements;
  } catch {
    return null;
  }
}

/**
 * Find the first accepted payment option that matches the signer's network.
 * Returns `null` if no match.
 */
export function filterAcceptsByNetwork(
  accepts: X402AcceptedPayment[],
  network: string,
): X402AcceptedPayment | null {
  return accepts.find((a) => a.network === network) ?? null;
}

/**
 * Wrap a fetch call with x402 auto-sign-and-retry.
 *
 * On 402, signs with the provided signer and retries once. If the retry
 * also returns 402 (e.g. insufficient funds), throws PaymentRequiredError.
 *
 * @param fetchFn — The underlying fetch to call.
 * @param signer — Wallet signer for producing payment signatures.
 * @param url — Request URL.
 * @param init — Request init (method, headers, body).
 * @returns The successful Response (never a 402).
 * @throws {PaymentRequiredError} if no matching network or retry fails.
 */
export async function fetchWithX402(
  fetchFn: typeof globalThis.fetch,
  signer: X402Signer,
  url: string,
  init: RequestInit,
): Promise<Response> {
  // First attempt
  const res = await fetchFn(url, init);

  if (res.status !== 402) return res;

  // ── Parse 402 ──
  const requirements = parsePaymentRequired(res.headers);
  if (!requirements) {
    throw await buildPaymentError(res, null);
  }

  // ── Find matching network ──
  const accepted = filterAcceptsByNetwork(
    requirements.accepts,
    signer.network,
  );
  if (!accepted) {
    throw await buildPaymentError(res, requirements);
  }

  // ── Sign payment ──
  const signature = await signer.sign(requirements);

  // ── Retry with signature ──
  const retryHeaders = new Headers(init.headers as HeadersInit | undefined);
  retryHeaders.set('PAYMENT-SIGNATURE', signature);

  const retryRes = await fetchFn(url, {
    ...init,
    headers: retryHeaders,
  });

  if (retryRes.status === 402) {
    throw await buildPaymentError(retryRes, requirements);
  }

  return retryRes;
}

// ── Helpers ──────────────────────────────────────────────────────────

async function buildPaymentError(
  res: Response,
  requirements: X402PaymentRequirements | null,
): Promise<PaymentRequiredError> {
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    // non-JSON response
  }
  const message =
    (body.error as string | undefined) ??
    (body.message as string | undefined) ??
    'Payment required';
  return new PaymentRequiredError(message, res.headers, body, requirements);
}
