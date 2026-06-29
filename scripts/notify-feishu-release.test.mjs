import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
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
      runNumber: '17',
      runUrl: 'https://github.com/acme/pipeline/actions/runs/28355213213',
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
    assert.match(JSON.stringify(payload), /\[#17\]/);
    assert.match(JSON.stringify(payload), /OSS 地址/);
    assert.doesNotMatch(JSON.stringify(payload), /查看 GitHub Actions/);
  });

  test('builds one card containing multiple Android artifacts', () => {
    const payload = buildFeishuCardPayload({
      artifacts: [
        {
          artifactName: 'mobile-app-1.0.2-112-internal-android.aab',
          artifactType: 'aab',
          buildNumber: '112',
          buildResult: 'success',
          target: 'internal',
        },
        {
          artifactName: 'mobile-app-1.0.2-112-cn-android.apk',
          artifactType: 'apk',
          buildNumber: '112',
          buildResult: 'success',
          ossDestination: 'oss://chat2db-cdn/ottermind/mobile/android/ottermind_Android_1.0.2-112.apk',
          ossPublicUrl: 'https://cdn.example.com/ottermind/mobile/android/ottermind_Android_1.0.2-112.apk',
          ossUpload: 'true',
          target: 'cn',
        },
      ],
      jobResults: ['success', 'success', 'skipped'],
      platform: 'android',
      ref: 'mobile-v1.0.2',
      runNumber: '18',
      runUrl: 'https://github.com/acme/pipeline/actions/runs/28355204029',
      submitToStore: false,
      target: 'internal',
      version: '1.0.2',
    });

    const text = JSON.stringify(payload);
    assert.match(text, /mobile-app-1\.0\.2-112-internal-android\.aab/);
    assert.match(text, /mobile-app-1\.0\.2-112-cn-android\.apk/);
    assert.match(text, /ottermind_Android_1\.0\.2-112\.apk/);
    assert.match(text, /\[#18\]/);
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

  test('reads GitHub workflow run number from env', () => {
    const input = buildNotificationInputFromEnv({
      FEISHU_RELEASE_WEBHOOK_URL: 'https://example.com/webhook',
      GITHUB_RUN_NUMBER: '17',
      GITHUB_RUN_URL: 'https://github.com/acme/pipeline/actions/runs/28355213213',
      RELEASE_PLATFORM: 'ios',
      RELEASE_REF: 'mobile-v1.0.2',
    });

    assert.equal(input.runNumber, '17');
    assert.equal(input.runUrl, 'https://github.com/acme/pipeline/actions/runs/28355213213');
  });

  test('reads release artifact summaries from a directory', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'otter-feishu-summary-'));
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, 'internal-aab.json'), JSON.stringify({
        artifactName: 'mobile-app-1.0.2-112-internal-android.aab',
        artifactType: 'aab',
        buildNumber: '112',
        buildResult: 'success',
        target: 'internal',
      }));
      writeFileSync(path.join(dir, 'cn-apk.json'), JSON.stringify({
        artifactName: 'mobile-app-1.0.2-112-cn-android.apk',
        artifactType: 'apk',
        buildNumber: '112',
        buildResult: 'success',
        ossDestination: 'oss://chat2db-cdn/ottermind/mobile/android/ottermind_Android_1.0.2-112.apk',
        ossUpload: 'true',
        target: 'cn',
      }));

      const input = buildNotificationInputFromEnv({
        FEISHU_RELEASE_WEBHOOK_URL: 'https://example.com/webhook',
        RELEASE_ARTIFACTS_JSON_DIR: dir,
        RELEASE_PLATFORM: 'android',
        RELEASE_REF: 'mobile-v1.0.2',
      });

      assert.equal(input.artifacts.length, 2);
      assert.deepEqual(
        input.artifacts.map((artifact) => artifact.artifactName).sort(),
        [
          'mobile-app-1.0.2-112-cn-android.apk',
          'mobile-app-1.0.2-112-internal-android.aab',
        ],
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
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
