/**
 * Messaging module — linked messaging platform management + test delivery.
 *
 * - `list()` — list linked messaging platforms
 * - `linkTelegram(code)` — link a Telegram account via verification code
 * - `unlinkTelegram()` — unlink a Telegram account
 * - `test()` — trigger test delivery to all linked platforms
 */

import type { AttaGoClient } from './index.js';

// ── Response types ──────────────────────────────────────────────────

/** A linked messaging platform entry. */
export interface MessagingLink {
  userId: string;
  platform: 'telegram';
  chatId: string;
  username: string;
  linkedAt: string;
}

/** Response from listing linked messaging platforms. */
export interface MessagingLinkList {
  items: MessagingLink[];
}

/** Result of a test delivery to linked messaging platforms. */
export interface MessagingTestResult {
  results: {
    telegram?: {
      success: boolean;
      error: string | null;
    };
  };
}

// ── Module ──────────────────────────────────────────────────────────

/**
 * Messaging platform management + test delivery.
 *
 * @example
 * ```ts
 * // List linked platforms
 * const links = await client.messaging.list();
 *
 * // Link Telegram via verification code
 * const result = await client.messaging.linkTelegram('ABC123');
 * console.log(result.username); // '@mybot'
 *
 * // Test delivery to all linked platforms
 * const test = await client.messaging.test();
 * console.log(test.results.telegram?.success); // true
 *
 * // Unlink Telegram
 * await client.messaging.unlinkTelegram();
 * ```
 */
export class MessagingModule {
  /** @internal */
  constructor(private readonly _client: AttaGoClient) {}

  /**
   * List linked messaging platforms.
   */
  async list(): Promise<MessagingLinkList> {
    return this._client.request<MessagingLinkList>('GET', '/user/messaging');
  }

  /**
   * Link a Telegram account using a verification code.
   *
   * The code is obtained by sending `/start` to the AttaGo Telegram bot.
   *
   * @param code — Verification code from the Telegram bot.
   */
  async linkTelegram(
    code: string,
  ): Promise<{ linked: boolean; username: string }> {
    return this._client.request<{ linked: boolean; username: string }>(
      'POST',
      '/user/messaging/telegram/link',
      { body: { code } },
    );
  }

  /**
   * Unlink a Telegram account.
   */
  async unlinkTelegram(): Promise<{ unlinked: boolean }> {
    return this._client.request<{ unlinked: boolean }>(
      'DELETE',
      '/user/messaging/telegram',
    );
  }

  /**
   * Trigger a test delivery to all linked messaging platforms.
   *
   * Sends a test message through the production pipeline.
   */
  async test(): Promise<MessagingTestResult> {
    return this._client.request<MessagingTestResult>(
      'POST',
      '/user/messaging/test',
    );
  }
}
