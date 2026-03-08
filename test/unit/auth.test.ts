import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CognitoAuth } from '../../src/auth.js';
import { AuthError, MfaRequiredError } from '../../src/errors.js';

// ── Helpers ─────────────────────────────────────────────────────────

/** Build a fake JWT with the given `exp` (unix seconds). */
function makeJwt(exp: number): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({ exp, sub: 'user-123', email: 'test@example.com' }),
  ).toString('base64url');
  const sig = Buffer.from('fake-signature').toString('base64url');
  return `${header}.${payload}.${sig}`;
}

interface FetchCall {
  url: string;
  init: RequestInit;
}

/**
 * Create a mock fetch that returns a sequence of canned responses.
 * Each response is consumed in order; extra calls throw.
 */
function mockFetch(responses: Array<{ status: number; body: unknown }>) {
  let idx = 0;
  const calls: FetchCall[] = [];

  const fn = async (
    url: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const response = responses[idx++];
    if (!response) throw new Error(`Unexpected fetch call #${idx}`);
    calls.push({ url: url.toString(), init: init ?? {} });
    return new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  return { fn: fn as typeof globalThis.fetch, calls };
}

const CLIENT_ID = 'test-client-id';
const REGION = 'us-east-1';
const EMAIL = 'test@example.com';
const PASSWORD = 'Test1234!';

function authResult(exp: number) {
  return {
    AuthenticationResult: {
      IdToken: makeJwt(exp),
      AccessToken: 'access-token',
      RefreshToken: 'refresh-token',
    },
  };
}

// ── Tests ───────────────────────────────────────────────────────────

describe('CognitoAuth', () => {
  describe('signIn', () => {
    it('should authenticate with email and password', async () => {
      const exp = Math.floor(Date.now() / 1000) + 3600;
      const { fn, calls } = mockFetch([{ status: 200, body: authResult(exp) }]);

      const auth = new CognitoAuth(CLIENT_ID, REGION, fn, EMAIL, PASSWORD);
      await auth.signIn();

      assert.equal(auth.isSignedIn, true);
      assert.equal(calls.length, 1);
      assert.equal(
        calls[0]!.url,
        `https://cognito-idp.${REGION}.amazonaws.com/`,
      );

      const body = JSON.parse(calls[0]!.init.body as string);
      assert.equal(body.AuthFlow, 'USER_PASSWORD_AUTH');
      assert.equal(body.ClientId, CLIENT_ID);
      assert.equal(body.AuthParameters.USERNAME, EMAIL);
      assert.equal(body.AuthParameters.PASSWORD, PASSWORD);

      const headers = calls[0]!.init.headers as Record<string, string>;
      assert.equal(
        headers['X-Amz-Target'],
        'AWSCognitoIdentityProviderService.InitiateAuth',
      );
    });

    it('should throw MfaRequiredError when MFA is needed', async () => {
      const { fn } = mockFetch([
        {
          status: 200,
          body: {
            ChallengeName: 'SOFTWARE_TOKEN_MFA',
            Session: 'mfa-session-token',
          },
        },
      ]);

      const auth = new CognitoAuth(CLIENT_ID, REGION, fn, EMAIL, PASSWORD);

      await assert.rejects(
        () => auth.signIn(),
        (err: unknown) => {
          assert.ok(err instanceof MfaRequiredError);
          assert.equal(err.session, 'mfa-session-token');
          assert.equal(err.challengeName, 'SOFTWARE_TOKEN_MFA');
          return true;
        },
      );
    });

    it('should throw AuthError on invalid credentials', async () => {
      const { fn } = mockFetch([
        {
          status: 400,
          body: {
            __type:
              'com.amazonaws.cognito.idp.model#NotAuthorizedException',
            message: 'Incorrect username or password.',
          },
        },
      ]);

      const auth = new CognitoAuth(CLIENT_ID, REGION, fn, EMAIL, PASSWORD);

      await assert.rejects(
        () => auth.signIn(),
        (err: unknown) => {
          assert.ok(err instanceof AuthError);
          assert.equal(err.code, 'NotAuthorizedException');
          assert.match(err.message, /Incorrect username/);
          return true;
        },
      );
    });

    it('should throw AuthError when no credentials provided', async () => {
      const { fn } = mockFetch([]);
      const auth = new CognitoAuth(CLIENT_ID, REGION, fn);

      await assert.rejects(
        () => auth.signIn(),
        (err: unknown) => {
          assert.ok(err instanceof AuthError);
          assert.match(err.message, /Email and password are required/);
          return true;
        },
      );
    });
  });

  describe('respondToMfa', () => {
    it('should complete MFA challenge and set signed-in state', async () => {
      const exp = Math.floor(Date.now() / 1000) + 3600;
      const { fn, calls } = mockFetch([
        {
          status: 200,
          body: {
            ChallengeName: 'SOFTWARE_TOKEN_MFA',
            Session: 'session-1',
          },
        },
        { status: 200, body: authResult(exp) },
      ]);

      const auth = new CognitoAuth(CLIENT_ID, REGION, fn, EMAIL, PASSWORD);

      try {
        await auth.signIn();
        assert.fail('Should have thrown MfaRequiredError');
      } catch (err) {
        assert.ok(err instanceof MfaRequiredError);
        await auth.respondToMfa(err.session, '123456');
      }

      assert.equal(auth.isSignedIn, true);
      assert.equal(calls.length, 2);

      const mfaBody = JSON.parse(calls[1]!.init.body as string);
      assert.equal(mfaBody.ChallengeName, 'SOFTWARE_TOKEN_MFA');
      assert.equal(mfaBody.Session, 'session-1');
      assert.equal(
        mfaBody.ChallengeResponses.SOFTWARE_TOKEN_MFA_CODE,
        '123456',
      );
    });
  });

  describe('getIdToken', () => {
    it('should lazy sign-in on first call when credentials are stored', async () => {
      const exp = Math.floor(Date.now() / 1000) + 3600;
      const jwt = makeJwt(exp);
      const { fn } = mockFetch([
        {
          status: 200,
          body: {
            AuthenticationResult: {
              IdToken: jwt,
              AccessToken: 'a',
              RefreshToken: 'r',
            },
          },
        },
      ]);

      const auth = new CognitoAuth(CLIENT_ID, REGION, fn, EMAIL, PASSWORD);
      assert.equal(auth.isSignedIn, false);

      const token = await auth.getIdToken();
      assert.equal(token, jwt);
      assert.equal(auth.isSignedIn, true);
    });

    it('should auto-refresh when token is near expiry', async () => {
      const nearExpiry = Math.floor(Date.now() / 1000) + 30; // within 60 s buffer
      const freshExp = Math.floor(Date.now() / 1000) + 3600;
      const freshJwt = makeJwt(freshExp);

      const { fn } = mockFetch([
        // signIn
        {
          status: 200,
          body: {
            AuthenticationResult: {
              IdToken: makeJwt(nearExpiry),
              AccessToken: 'a',
              RefreshToken: 'r',
            },
          },
        },
        // refresh
        {
          status: 200,
          body: {
            AuthenticationResult: {
              IdToken: freshJwt,
              AccessToken: 'new-a',
            },
          },
        },
      ]);

      const auth = new CognitoAuth(CLIENT_ID, REGION, fn, EMAIL, PASSWORD);
      await auth.signIn();

      // Token expires within 60 s → triggers refresh
      const token = await auth.getIdToken();
      assert.equal(token, freshJwt);
    });

    it('should throw if not signed in and no credentials', async () => {
      const { fn } = mockFetch([]);
      const auth = new CognitoAuth(CLIENT_ID, REGION, fn);

      await assert.rejects(
        () => auth.getIdToken(),
        (err: unknown) => {
          assert.ok(err instanceof AuthError);
          assert.match(err.message, /Not signed in/);
          return true;
        },
      );
    });
  });

  describe('signOut', () => {
    it('should clear tokens on local sign-out', async () => {
      const exp = Math.floor(Date.now() / 1000) + 3600;
      const { fn } = mockFetch([{ status: 200, body: authResult(exp) }]);

      const auth = new CognitoAuth(CLIENT_ID, REGION, fn, EMAIL, PASSWORD);
      await auth.signIn();
      assert.equal(auth.isSignedIn, true);
      assert.ok(auth.getTokens() !== null);

      await auth.signOut();
      assert.equal(auth.isSignedIn, false);
      assert.equal(auth.getTokens(), null);
    });

    it('should call GlobalSignOut when global=true', async () => {
      const exp = Math.floor(Date.now() / 1000) + 3600;
      const { fn, calls } = mockFetch([
        { status: 200, body: authResult(exp) },
        { status: 200, body: {} }, // GlobalSignOut response
      ]);

      const auth = new CognitoAuth(CLIENT_ID, REGION, fn, EMAIL, PASSWORD);
      await auth.signIn();
      await auth.signOut(true);

      assert.equal(calls.length, 2);
      const headers = calls[1]!.init.headers as Record<string, string>;
      assert.equal(
        headers['X-Amz-Target'],
        'AWSCognitoIdentityProviderService.GlobalSignOut',
      );
    });
  });

  describe('token persistence', () => {
    it('should export and restore tokens', async () => {
      const exp = Math.floor(Date.now() / 1000) + 3600;
      const jwt = makeJwt(exp);
      const { fn } = mockFetch([
        {
          status: 200,
          body: {
            AuthenticationResult: {
              IdToken: jwt,
              AccessToken: 'access-token',
              RefreshToken: 'refresh-token',
            },
          },
        },
      ]);

      // Sign in and export tokens
      const auth1 = new CognitoAuth(CLIENT_ID, REGION, fn, EMAIL, PASSWORD);
      await auth1.signIn();
      const tokens = auth1.getTokens();
      assert.ok(tokens);
      assert.equal(tokens.idToken, jwt);
      assert.equal(tokens.accessToken, 'access-token');
      assert.equal(tokens.refreshToken, 'refresh-token');

      // Restore in a new instance
      const auth2 = new CognitoAuth(CLIENT_ID, REGION, fn);
      auth2.setTokens(tokens);
      assert.equal(auth2.isSignedIn, true);

      const token = await auth2.getIdToken();
      assert.equal(token, jwt);
    });
  });

  describe('static methods', () => {
    it('signUp should send correct Cognito request', async () => {
      const { fn, calls } = mockFetch([
        { status: 200, body: { UserSub: 'user-sub-123' } },
      ]);

      const result = await CognitoAuth.signUp({
        email: EMAIL,
        password: PASSWORD,
        cognitoClientId: CLIENT_ID,
        cognitoRegion: REGION,
        fetch: fn,
      });

      assert.equal(result.userSub, 'user-sub-123');
      assert.equal(calls.length, 1);

      const body = JSON.parse(calls[0]!.init.body as string);
      assert.equal(body.ClientId, CLIENT_ID);
      assert.equal(body.Username, EMAIL);
      assert.equal(body.Password, PASSWORD);
      assert.deepEqual(body.UserAttributes, [
        { Name: 'email', Value: EMAIL },
      ]);

      const headers = calls[0]!.init.headers as Record<string, string>;
      assert.equal(
        headers['X-Amz-Target'],
        'AWSCognitoIdentityProviderService.SignUp',
      );
    });

    it('confirmSignUp should send correct request', async () => {
      const { fn, calls } = mockFetch([{ status: 200, body: {} }]);

      await CognitoAuth.confirmSignUp({
        email: EMAIL,
        code: '123456',
        cognitoClientId: CLIENT_ID,
        cognitoRegion: REGION,
        fetch: fn,
      });

      const body = JSON.parse(calls[0]!.init.body as string);
      assert.equal(body.ConfirmationCode, '123456');

      const headers = calls[0]!.init.headers as Record<string, string>;
      assert.equal(
        headers['X-Amz-Target'],
        'AWSCognitoIdentityProviderService.ConfirmSignUp',
      );
    });

    it('forgotPassword should send correct request', async () => {
      const { fn, calls } = mockFetch([{ status: 200, body: {} }]);

      await CognitoAuth.forgotPassword({
        email: EMAIL,
        cognitoClientId: CLIENT_ID,
        cognitoRegion: REGION,
        fetch: fn,
      });

      const headers = calls[0]!.init.headers as Record<string, string>;
      assert.equal(
        headers['X-Amz-Target'],
        'AWSCognitoIdentityProviderService.ForgotPassword',
      );
    });

    it('confirmForgotPassword should send correct request', async () => {
      const { fn, calls } = mockFetch([{ status: 200, body: {} }]);

      await CognitoAuth.confirmForgotPassword({
        email: EMAIL,
        code: '654321',
        newPassword: 'NewPass1234!',
        cognitoClientId: CLIENT_ID,
        cognitoRegion: REGION,
        fetch: fn,
      });

      const body = JSON.parse(calls[0]!.init.body as string);
      assert.equal(body.ConfirmationCode, '654321');
      assert.equal(body.Password, 'NewPass1234!');

      const headers = calls[0]!.init.headers as Record<string, string>;
      assert.equal(
        headers['X-Amz-Target'],
        'AWSCognitoIdentityProviderService.ConfirmForgotPassword',
      );
    });

    it('signUp should throw AuthError on Cognito error', async () => {
      const { fn } = mockFetch([
        {
          status: 400,
          body: {
            __type: 'UsernameExistsException',
            message: 'An account with the given email already exists.',
          },
        },
      ]);

      await assert.rejects(
        () =>
          CognitoAuth.signUp({
            email: EMAIL,
            password: PASSWORD,
            cognitoClientId: CLIENT_ID,
            fetch: fn,
          }),
        (err: unknown) => {
          assert.ok(err instanceof AuthError);
          assert.equal(err.code, 'UsernameExistsException');
          return true;
        },
      );
    });
  });
});
