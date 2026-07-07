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

  test('builds an interactive release card with artifact and source ref links (aab)', () => {
    const payload = buildFeishuCardPayload({
      artifactName: 'mobile-app-1.0.2-108-internal-android.aab',
      buildNumber: '108',
      jobResults: ['success', 'success', 'skipped'],
      platform: 'android',
      ref: 'mobile-v1.0.2',
      runNumber: '17',
      runUrl: 'https://github.com/acme/pipeline/actions/runs/28355213213',
      submitToStore: true,
      target: 'internal',
      version: '1.0.2',
    });

    assert.equal(payload.msg_type, 'interactive');
    assert.equal(payload.card.header.template, 'green');
    assert.match(payload.card.header.title.content, /Android/);

    const text = JSON.stringify(payload);
    // 产物字段携带 Google Play Console 固定超链
    assert.match(text, /\[mobile-app-1\.0\.2-108-internal-android\.aab\]\(https:\/\/play\.google\.com\/console\/u\/0\/developers\/7538199493925030729\/app\/4973906953075418289\/publishing\/submission-activity\)/);
    // 源码 ref 携带 GitHub Release 超链
    assert.match(text, /\[mobile-v1\.0\.2\]\(https:\/\/github\.com\/OtterMind\/ottermind\/releases\/tag\/mobile-v1\.0\.2\)/);
    // Actions 超链
    assert.match(text, /Actions/);
    assert.match(text, /\[#17\]/);
    // 产物列表 / OSS 字段已移除
    assert.doesNotMatch(text, /产物列表/);
    assert.doesNotMatch(text, /OSS 地址/);
    assert.doesNotMatch(text, /OSS 上传/);
    assert.doesNotMatch(text, /查看 GitHub Actions/);
  });

  test('links apk artifact to its OSS public url from artifact summaries', () => {
    const payload = buildFeishuCardPayload({
      artifactName: 'mobile-app-1.0.2-112-cn-android.apk',
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
      target: 'cn',
      version: '1.0.2',
    });

    const text = JSON.stringify(payload);
    assert.match(text, /\[mobile-app-1\.0\.2-112-cn-android\.apk\]\(https:\/\/cdn\.example\.com\/ottermind\/mobile\/android\/ottermind_Android_1\.0\.2-112\.apk\)/);
    assert.match(text, /\[#18\]/);
    assert.doesNotMatch(text, /产物列表/);
    assert.doesNotMatch(text, /OSS 上传/);
  });

  test('falls back to cdn rule url for apk when oss public url is missing', () => {
    const payload = buildFeishuCardPayload({
      artifactName: 'mobile-app-1.0.7-112-cn-android.apk',
      buildNumber: '112',
      jobResults: ['success'],
      platform: 'android',
      ref: 'mobile-v1.0.7',
      target: 'cn',
      version: '1.0.7',
    });

    const text = JSON.stringify(payload);
    assert.match(text, /\[mobile-app-1\.0\.7-112-cn-android\.apk\]\(https:\/\/cdn\.chat2db-ai\.com\/ottermind\/mobile\/android\/ottermind_Android_1\.0\.7-112\.apk\)/);
  });

  test('links ios artifact to App Store Connect TestFlight', () => {
    const payload = buildFeishuCardPayload({
      artifactName: 'mobile-app-1.0.7-124-production-ios.ipa',
      buildNumber: '124',
      jobResults: ['success', 'success', 'success'],
      platform: 'ios',
      ref: 'mobile-v1.0.7',
      runNumber: '18',
      runUrl: 'https://github.com/acme/pipeline/actions/runs/28355204029',
      submitToStore: true,
      target: 'production',
      version: '1.0.7',
    });

    const text = JSON.stringify(payload);
    assert.match(text, /\[mobile-app-1\.0\.7-124-production-ios\.ipa\]\(https:\/\/appstoreconnect\.apple\.com\/teams\/b10774f3-6988-4d42-acec-e250bcd60832\/apps\/6764060074\/testflight\/ios\)/);
    assert.match(text, /\[mobile-v1\.0\.7\]\(https:\/\/github\.com\/OtterMind\/ottermind\/releases\/tag\/mobile-v1\.0\.7\)/);
    assert.doesNotMatch(text, /产物列表/);
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
