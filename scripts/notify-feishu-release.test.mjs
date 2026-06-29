import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { describe, test } from 'node:test';

import {
  buildFeishuCardPayload,
  buildNotificationInputFromEnv,
  buildSignedBody,
  resolveOverallStatus,
  sendFeishuNotification,
} from './notify-feishu-release.mjs';

describe('notify-feishu-release', () => {
  test('resolves success when optional submit job is skipped after a successful build', () => {
    assert.equal(resolveOverallStatus(['success', 'success', 'skipped']), 'success');
  });

  test('resolves failure when any required job failed', () => {
    assert.equal(resolveOverallStatus(['success', 'failure', 'skipped']), 'failure');
  });

  test('builds an interactive release result card', () => {
    const payload = buildFeishuCardPayload({
      artifactName: 'mobile-app-1.0.2-108-internal-android.aab',
      buildNumber: '108',
      jobResults: ['success', 'success', 'skipped'],
      platform: 'android',
      ref: 'mobile-v1.0.2',
      runUrl: 'https://github.com/acme/pipeline/actions/runs/1',
      ossDestination: 'oss://mobile-release/ottermind/android/1.0.2/mobile.apk',
      ossUpload: true,
      submitToStore: true,
      target: 'internal',
      version: '1.0.2',
    });

    assert.equal(payload.msg_type, 'interactive');
    assert.equal(payload.card.header.template, 'green');
    assert.match(payload.card.header.title.content, /Android/);
    assert.match(JSON.stringify(payload), /mobile-app-1\.0\.2-108-internal-android\.aab/);
    assert.match(JSON.stringify(payload), /OSS 上传/);
    assert.match(JSON.stringify(payload), /Actions/);
    assert.match(JSON.stringify(payload), /\[#1\]/);
    assert.match(JSON.stringify(payload), /OSS 地址/);
    assert.doesNotMatch(JSON.stringify(payload), /查看 GitHub Actions/);
  });

  test('adds Feishu signature fields when a webhook secret is configured', () => {
    const payload = { msg_type: 'text', content: { text: 'ok' } };
    const signed = buildSignedBody(payload, {
      secret: 'bot-secret',
      timestamp: 1700000000,
    });

    const expectedSign = createHmac('sha256', '1700000000\nbot-secret')
      .update('')
      .digest('base64');
    assert.equal(signed.timestamp, '1700000000');
    assert.equal(signed.sign, expectedSign);
    assert.equal(signed.msg_type, 'text');
  });

  test('returns a skipped notification input when webhook url is missing', () => {
    const input = buildNotificationInputFromEnv({
      RELEASE_PLATFORM: 'ios',
      RELEASE_REF: 'mobile-v1.0.2',
    });

    assert.equal(input.skipped, true);
  });

  test('does not throw when Feishu returns an error response', async () => {
    const result = await sendFeishuNotification({
      fetchImpl: async () => ({
        ok: false,
        status: 500,
        text: async () => 'server error',
      }),
      payload: { msg_type: 'text', content: { text: 'ok' } },
      warn: () => {},
      webhookUrl: 'https://example.com/webhook',
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, 500);
  });

  test('treats Feishu non-zero JSON code as a failed notification', async () => {
    const result = await sendFeishuNotification({
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ code: 9499, msg: 'bad sign' }),
      }),
      payload: { msg_type: 'text', content: { text: 'ok' } },
      warn: () => {},
      webhookUrl: 'https://example.com/webhook',
    });

    assert.equal(result.ok, false);
    assert.equal(result.feishuCode, 9499);
  });
});
