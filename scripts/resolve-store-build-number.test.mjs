import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { describe, test } from 'node:test';

import { resolveStoreBuildNumber } from './resolve-store-build-number.mjs';

const silentLogger = { warn() {} };

function androidEnv() {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    ANDROID_PACKAGE_NAME: 'ai.ottermind.mobile',
    GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64: Buffer.from(JSON.stringify({
      client_email: 'ci@ottermind.iam.gserviceaccount.com',
      private_key: privateKey.export({ type: 'pkcs1', format: 'pem' }),
    })).toString('base64'),
  };
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  };
}

function createPlayFetch(trackResponses) {
  const calls = { deletes: 0, inserts: 0, tracks: 0 };
  const fetchImpl = async (url, options = {}) => {
    const method = options.method ?? 'GET';
    const href = String(url);
    if (href.includes('oauth2.googleapis.com')) {
      return jsonResponse(200, { access_token: 'test-token' });
    }
    if (method === 'POST' && href.endsWith('/edits')) {
      calls.inserts += 1;
      return jsonResponse(200, { id: `edit-${calls.inserts}` });
    }
    if (method === 'GET' && href.endsWith('/tracks')) {
      const response = trackResponses[calls.tracks] ?? {
        status: 200,
        body: { tracks: [{ releases: [{ versionCodes: ['140'] }] }] },
      };
      calls.tracks += 1;
      return jsonResponse(response.status, response.body);
    }
    if (method === 'DELETE') {
      calls.deletes += 1;
      return jsonResponse(204);
    }
    throw new Error(`unexpected request: ${method} ${href}`);
  };
  return { calls, fetchImpl };
}

describe('resolve-store-build-number (android)', () => {
  test('retries with a fresh edit when a concurrent run discards the edit', async () => {
    const { calls, fetchImpl } = createPlayFetch([
      { status: 400, body: { error: { message: 'This Edit has been deleted.' } } },
      { status: 200, body: { tracks: [{ releases: [{ versionCodes: ['140'] }] }] } },
    ]);

    const result = await resolveStoreBuildNumber({
      platform: 'android',
      env: androidEnv(),
      fetchImpl,
      logger: silentLogger,
    });

    assert.equal(result, '141');
    assert.deepEqual(calls, { deletes: 2, inserts: 2, tracks: 2 });
  });

  test('does not retry unrelated Play failures', async () => {
    const { calls, fetchImpl } = createPlayFetch([
      { status: 403, body: { error: { message: 'The caller does not have permission' } } },
    ]);

    await assert.rejects(
      resolveStoreBuildNumber({
        platform: 'android',
        env: androidEnv(),
        fetchImpl,
        logger: silentLogger,
      }),
      /Google Play tracks list failed \(403\)/,
    );

    assert.deepEqual(calls, { deletes: 1, inserts: 1, tracks: 1 });
  });
});
