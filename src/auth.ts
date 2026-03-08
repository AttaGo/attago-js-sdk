/**
 * Cognito authentication — zero-dependency REST client.
 *
 * Talks directly to `cognito-idp.{region}.amazonaws.com` using the
 * `X-Amz-Target` JSON RPC convention (same approach as the AttaGo frontend).
 * No AWS SDK dependency.
 */

import { AuthError, MfaRequiredError } from './errors.js';
import {
  DEFAULT_COGNITO_REGION,
  type CognitoTokens,
  type SignUpOptions,
  type ConfirmSignUpOptions,
  type ForgotPasswordOptions,
  type ConfirmForgotPasswordOptions,
} from './types.js';

/**
 * Manages Cognito sign-in, token refresh, MFA, and registration flows.
 */
export class CognitoAuth {
  private _idToken: string | null = null;
  private _accessToken: string | null = null;
  private _refreshToken: string | null = null;
  private _tokenExpiresAt = 0;
  private _signedIn = false;

  constructor(
    private readonly _clientId: string,
    private readonly _region: string,
    private readonly _fetch: typeof globalThis.fetch,
    private _email?: string,
    private _password?: string,
  ) {}

  // ── Public getters ───────────────────────────────────────────────

  /** Whether the user is currently authenticated. */
  get isSignedIn(): boolean {
    return this._signedIn;
  }

  // ── Token access ─────────────────────────────────────────────────

  /**
   * Get a valid ID token, auto-refreshing if needed.
   *
   * If credentials were provided to the constructor, triggers lazy sign-in
   * on the first call.
   *
   * @throws {AuthError} if not signed in and no stored credentials
   * @throws {MfaRequiredError} if lazy sign-in requires MFA
   */
  async getIdToken(): Promise<string> {
    if (!this._signedIn) {
      if (this._email && this._password) {
        await this.signIn(this._email, this._password);
      } else {
        throw new AuthError(
          'Not signed in. Call signIn() first or provide email/password.',
        );
      }
    }

    // Refresh if within 60 s of expiry
    if (Date.now() >= this._tokenExpiresAt - 60_000) {
      if (this._refreshToken) {
        await this._refreshTokens();
      } else {
        throw new AuthError('Token expired and no refresh token available.');
      }
    }

    return this._idToken!;
  }

  // ── Sign-in / MFA ───────────────────────────────────────────────

  /**
   * Sign in with email and password.
   *
   * @throws {MfaRequiredError} if TOTP MFA is enabled on the account.
   *   Catch the error and call {@link respondToMfa} with the session + code.
   * @throws {AuthError} on invalid credentials or Cognito errors.
   */
  async signIn(email?: string, password?: string): Promise<void> {
    const e = email ?? this._email;
    const p = password ?? this._password;
    if (!e || !p) {
      throw new AuthError('Email and password are required for sign-in.');
    }

    const result = await this._cognitoRequest('InitiateAuth', {
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: this._clientId,
      AuthParameters: { USERNAME: e, PASSWORD: p },
    });

    if (result.ChallengeName) {
      if (result.ChallengeName === 'SOFTWARE_TOKEN_MFA') {
        this._email = e;
        throw new MfaRequiredError(
          result.Session as string,
          result.ChallengeName as string,
        );
      }
      throw new AuthError(
        `Unsupported auth challenge: ${result.ChallengeName as string}`,
      );
    }

    this._setTokens(result.AuthenticationResult as Record<string, string>);
    this._email = e;
    this._password = p;
  }

  /**
   * Complete an MFA challenge after catching {@link MfaRequiredError}.
   *
   * @param session — The `session` property from the caught MfaRequiredError.
   * @param code — The 6-digit TOTP code from the user's authenticator app.
   */
  async respondToMfa(session: string, code: string): Promise<void> {
    if (!this._email) {
      throw new AuthError('No email set. Call signIn() first.');
    }

    const result = await this._cognitoRequest('RespondToAuthChallenge', {
      ClientId: this._clientId,
      ChallengeName: 'SOFTWARE_TOKEN_MFA',
      Session: session,
      ChallengeResponses: {
        USERNAME: this._email,
        SOFTWARE_TOKEN_MFA_CODE: code,
      },
    });

    this._setTokens(result.AuthenticationResult as Record<string, string>);
  }

  // ── Sign-out ─────────────────────────────────────────────────────

  /**
   * Sign out and clear all tokens.
   *
   * @param global — If `true`, calls Cognito's GlobalSignOut to invalidate
   *   all sessions server-side (best-effort, won't throw on failure).
   */
  async signOut(global = false): Promise<void> {
    if (global && this._accessToken) {
      try {
        await this._cognitoRequest('GlobalSignOut', {
          AccessToken: this._accessToken,
        });
      } catch {
        // Best-effort — clear local tokens regardless
      }
    }

    this._idToken = null;
    this._accessToken = null;
    this._refreshToken = null;
    this._tokenExpiresAt = 0;
    this._signedIn = false;
  }

  // ── Token persistence ────────────────────────────────────────────

  /** Export current tokens for external persistence. Returns `null` if not signed in. */
  getTokens(): CognitoTokens | null {
    if (!this._idToken || !this._accessToken || !this._refreshToken) return null;
    return {
      idToken: this._idToken,
      accessToken: this._accessToken,
      refreshToken: this._refreshToken,
    };
  }

  /** Restore tokens from a previous session (skips sign-in). */
  setTokens(tokens: CognitoTokens): void {
    this._idToken = tokens.idToken;
    this._accessToken = tokens.accessToken;
    this._refreshToken = tokens.refreshToken;
    this._tokenExpiresAt = parseJwtExpiry(tokens.idToken);
    this._signedIn = true;
  }

  // ── Static registration flows ────────────────────────────────────

  /** Create a new account. Sends a verification code to the email. */
  static async signUp(opts: SignUpOptions): Promise<{ userSub: string }> {
    const f = opts.fetch ?? globalThis.fetch;
    const region = opts.cognitoRegion ?? DEFAULT_COGNITO_REGION;
    const result = await cognitoRequest(f, region, 'SignUp', {
      ClientId: opts.cognitoClientId,
      Username: opts.email,
      Password: opts.password,
      UserAttributes: [{ Name: 'email', Value: opts.email }],
    });
    return { userSub: result.UserSub as string };
  }

  /** Confirm a new account with the emailed verification code. */
  static async confirmSignUp(opts: ConfirmSignUpOptions): Promise<void> {
    const f = opts.fetch ?? globalThis.fetch;
    const region = opts.cognitoRegion ?? DEFAULT_COGNITO_REGION;
    await cognitoRequest(f, region, 'ConfirmSignUp', {
      ClientId: opts.cognitoClientId,
      Username: opts.email,
      ConfirmationCode: opts.code,
    });
  }

  /** Trigger a password-reset email. */
  static async forgotPassword(opts: ForgotPasswordOptions): Promise<void> {
    const f = opts.fetch ?? globalThis.fetch;
    const region = opts.cognitoRegion ?? DEFAULT_COGNITO_REGION;
    await cognitoRequest(f, region, 'ForgotPassword', {
      ClientId: opts.cognitoClientId,
      Username: opts.email,
    });
  }

  /** Complete a password reset with the emailed code + new password. */
  static async confirmForgotPassword(
    opts: ConfirmForgotPasswordOptions,
  ): Promise<void> {
    const f = opts.fetch ?? globalThis.fetch;
    const region = opts.cognitoRegion ?? DEFAULT_COGNITO_REGION;
    await cognitoRequest(f, region, 'ConfirmForgotPassword', {
      ClientId: opts.cognitoClientId,
      Username: opts.email,
      ConfirmationCode: opts.code,
      Password: opts.newPassword,
    });
  }

  // ── Private helpers ──────────────────────────────────────────────

  private async _refreshTokens(): Promise<void> {
    const result = await this._cognitoRequest('InitiateAuth', {
      AuthFlow: 'REFRESH_TOKEN_AUTH',
      ClientId: this._clientId,
      AuthParameters: { REFRESH_TOKEN: this._refreshToken },
    });

    const auth = result.AuthenticationResult as Record<string, string>;
    this._idToken = auth.IdToken ?? null;
    this._accessToken = auth.AccessToken ?? null;
    // Refresh token stays the same (Cognito doesn't rotate it)
    this._tokenExpiresAt = parseJwtExpiry(this._idToken ?? '');
  }

  private _setTokens(authResult: Record<string, string>): void {
    this._idToken = authResult.IdToken ?? null;
    this._accessToken = authResult.AccessToken ?? null;
    this._refreshToken = authResult.RefreshToken ?? this._refreshToken;
    this._tokenExpiresAt = parseJwtExpiry(this._idToken ?? '');
    this._signedIn = true;
  }

  private async _cognitoRequest(
    action: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return cognitoRequest(this._fetch, this._region, action, body);
  }
}

// ── Module-private helpers ──────────────────────────────────────────

/** Parse JWT `exp` claim → Unix ms. Falls back to +1 hour if unparseable. */
function parseJwtExpiry(jwt: string): number {
  try {
    const parts = jwt.split('.');
    const payload = JSON.parse(
      Buffer.from(parts[1]!, 'base64url').toString('utf8'),
    ) as { exp?: number };
    if (typeof payload.exp === 'number') return payload.exp * 1000;
  } catch {
    // fall through
  }
  return Date.now() + 3_600_000;
}

/** Send a single Cognito REST request. */
async function cognitoRequest(
  f: typeof globalThis.fetch,
  region: string,
  action: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const url = `https://cognito-idp.${region}.amazonaws.com/`;

  const res = await f(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': `AWSCognitoIdentityProviderService.${action}`,
    },
    body: JSON.stringify(body),
  });

  const data = (await res.json()) as Record<string, unknown>;

  if (!res.ok) {
    const rawType = (data.__type as string | undefined) ?? '';
    const code = rawType.includes('#') ? rawType.split('#').pop()! : rawType || 'UnknownError';
    const msg =
      (data.message as string | undefined) ??
      (data.Message as string | undefined) ??
      'Cognito request failed';
    throw new AuthError(msg, code);
  }

  return data;
}
