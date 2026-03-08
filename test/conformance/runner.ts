/**
 * Conformance runner — validates attago-spec fixtures against a live API.
 *
 * Usage:
 *   ATTAGO_BASE_URL=https://dev.attago.bid \
 *   ATTAGO_API_KEY=ak_live_... \
 *   node --import tsx test/conformance/runner.ts
 *
 * Loads fixtures from the attago-spec repo (cloned by CI or local),
 * sends real HTTP requests, and validates response status + schema.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

// ── Config ──────────────────────────────────────────────────────────

const BASE_URL = process.env.ATTAGO_BASE_URL;
const API_KEY = process.env.ATTAGO_API_KEY;
const SPEC_DIR = process.env.ATTAGO_SPEC_DIR ?? join(process.cwd(), 'attago-spec');

const FIXTURE_DIR = join(SPEC_DIR, 'spec', 'fixtures', 'rest');
const SCHEMA_DIR = join(SPEC_DIR, 'spec', 'schema');

// ── Types ───────────────────────────────────────────────────────────

interface Fixture {
  description: string;
  request: {
    method: string;
    path: string;
    headers?: Record<string, string>;
    query?: Record<string, string>;
    body?: unknown;
  };
  response: {
    status: number;
    schema?: string;
    body?: unknown;
  };
}

// ── Skip list — fixtures that need Cognito JWT (can't run in CI) ──

const SKIP_FIXTURES = new Set([
  'user-profile-success.json',
  'user-profile-unauthorized.json',
]);

// ── Runner ──────────────────────────────────────────────────────────

describe('Conformance', () => {
  let ajv: Ajv;

  before(() => {
    if (!BASE_URL) {
      console.log('⏭  ATTAGO_BASE_URL not set — skipping conformance tests');
      return;
    }

    if (!existsSync(FIXTURE_DIR)) {
      console.log(`⏭  Fixture dir not found: ${FIXTURE_DIR} — skipping`);
      return;
    }

    // Initialize ajv with all schemas
    ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);

    if (existsSync(SCHEMA_DIR)) {
      for (const file of readdirSync(SCHEMA_DIR)) {
        if (!file.endsWith('.schema.json')) continue;
        const schema = JSON.parse(readFileSync(join(SCHEMA_DIR, file), 'utf8'));
        const schemaName = file.replace('.schema.json', '');
        ajv.addSchema(schema, schemaName);
      }
    }
  });

  // Load and register all fixtures
  if (BASE_URL && existsSync(FIXTURE_DIR)) {
    const fixtureFiles = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.json'));

    for (const file of fixtureFiles) {
      if (SKIP_FIXTURES.has(file)) continue;

      const fixture = JSON.parse(
        readFileSync(join(FIXTURE_DIR, file), 'utf8'),
      ) as Fixture;

      // Skip fixtures that require auth we can't provide
      const needsAuth = fixture.request.headers?.['Authorization'];
      if (needsAuth && !API_KEY) continue;

      it(`${fixture.description} (${file})`, async () => {
        if (!BASE_URL) return; // Guard for test runner

        // Build URL
        const url = new URL(fixture.request.path, BASE_URL);
        if (fixture.request.query) {
          for (const [k, v] of Object.entries(fixture.request.query)) {
            url.searchParams.set(k, v);
          }
        }

        // Build headers
        const headers: Record<string, string> = {
          Accept: 'application/json',
          ...fixture.request.headers,
        };

        // Inject API key if fixture uses X-API-Key header
        if (headers['X-API-Key'] && API_KEY) {
          headers['X-API-Key'] = API_KEY;
        }

        // Send request
        const init: RequestInit = {
          method: fixture.request.method,
          headers,
        };
        if (fixture.request.body) {
          init.body = JSON.stringify(fixture.request.body);
          headers['Content-Type'] = 'application/json';
        }

        const res = await fetch(url.toString(), init);

        // Validate status code
        assert.equal(
          res.status,
          fixture.response.status,
          `Expected status ${fixture.response.status}, got ${res.status}`,
        );

        // Validate schema if specified
        if (fixture.response.schema && res.status < 400) {
          const body = await res.json();
          const validate = ajv.getSchema(fixture.response.schema);

          if (validate) {
            const valid = validate(body);
            if (!valid) {
              const errors = validate.errors
                ?.map((e) => `${e.instancePath} ${e.message}`)
                .join('\n');
              assert.fail(
                `Schema validation failed for ${fixture.response.schema}:\n${errors}`,
              );
            }
          }
        }
      });
    }
  } else {
    it('skipped — ATTAGO_BASE_URL not set or fixtures not found', () => {
      // Placeholder so the suite isn't empty
    });
  }
});
