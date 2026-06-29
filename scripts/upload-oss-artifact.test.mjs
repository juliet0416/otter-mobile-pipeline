import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { describe, test } from 'node:test';

import {
  buildOssAuthorization,
  buildOssUploadRequest,
  encodeObjectKey,
} from './upload-oss-artifact.mjs';

describe('upload-oss-artifact', () => {
  test('encodes object key path segments without losing slashes', () => {
    assert.equal(
      encodeObjectKey('ottermind/android/1.0.3/mobile app.apk'),
      'ottermind/android/1.0.3/mobile%20app.apk',
    );
  });

  test('builds OSS V1 authorization header for PutObject', () => {
    const authorization = buildOssAuthorization({
      accessKeyId: 'ak',
      accessKeySecret: 'sk',
      bucket: 'mobile-release',
      contentType: 'application/vnd.android.package-archive',
      date: 'Mon, 29 Jun 2026 00:00:00 GMT',
      objectKey: 'ottermind/android/1.0.3/mobile.apk',
    });

    const stringToSign = [
      'PUT',
      '',
      'application/vnd.android.package-archive',
      'Mon, 29 Jun 2026 00:00:00 GMT',
      '/mobile-release/ottermind/android/1.0.3/mobile.apk',
    ].join('\n');
    const expectedSignature = createHmac('sha1', 'sk').update(stringToSign).digest('base64');
    assert.equal(authorization, `OSS ak:${expectedSignature}`);
  });

  test('builds a virtual-hosted OSS upload request', () => {
    const request = buildOssUploadRequest({
      accessKeyId: 'ak',
      accessKeySecret: 'sk',
      bucket: 'mobile-release',
      contentLength: 1024,
      endpoint: 'https://oss-cn-hangzhou.aliyuncs.com',
      objectKey: 'ottermind/android/1.0.3/mobile.apk',
      now: () => new Date('2026-06-29T00:00:00Z'),
    });

    assert.equal(request.url, 'https://mobile-release.oss-cn-hangzhou.aliyuncs.com/ottermind/android/1.0.3/mobile.apk');
    assert.equal(request.headers['Content-Length'], 1024);
    assert.equal(request.headers.Date, 'Mon, 29 Jun 2026 00:00:00 GMT');
    assert.match(request.headers.Authorization, /^OSS ak:/);
  });
});
