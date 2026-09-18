import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  buildR2Authorization,
  buildR2UploadRequest,
  encodeObjectKey,
} from './upload-oss-artifact.mjs';

describe('upload-r2-artifact', () => {
  test('encodes object key path segments without losing slashes', () => {
    assert.equal(
      encodeObjectKey('ottermind/android/1.0.3/mobile app.apk'),
      'ottermind/android/1.0.3/mobile%20app.apk',
    );
  });

  test('builds R2 S3 SigV4 authorization header for PutObject', () => {
    const authorization = buildR2Authorization({
      accessKeyId: 'ak',
      accessKeySecret: 'sk',
      accountId: 'account',
      bucket: 'ottermind',
      cacheControl: 'public, max-age=31536000, immutable',
      contentType: 'application/vnd.android.package-archive',
      contentLength: 1024,
      objectKey: 'mobile/appUpdate/mobile.apk',
      now: () => new Date('2026-06-29T00:00:00Z'),
    });
    assert.match(authorization, /^AWS4-HMAC-SHA256 Credential=ak\/20260629\/auto\/s3\/aws4_request,/);
    assert.match(authorization, /SignedHeaders=cache-control;content-length;content-type;host;x-amz-content-sha256;x-amz-date/);
    assert.match(authorization, /, Signature=[0-9a-f]{64}$/);
  });

  test('builds an R2 S3 upload request with cache metadata', () => {
    const request = buildR2UploadRequest({
      accessKeyId: 'ak',
      accessKeySecret: 'sk',
      accountId: 'account',
      bucket: 'ottermind',
      contentLength: 1024,
      cacheControl: 'public, max-age=31536000, immutable',
      objectKey: 'mobile/appUpdate/mobile.apk',
      now: () => new Date('2026-06-29T00:00:00Z'),
    });

    assert.equal(request.url, 'https://account.r2.cloudflarestorage.com/ottermind/mobile/appUpdate/mobile.apk');
    assert.equal(request.headers['Content-Length'], 1024);
    assert.equal(request.headers['Cache-Control'], 'public, max-age=31536000, immutable');
    assert.equal(request.headers['x-amz-date'], '20260629T000000Z');
    assert.match(request.headers.Authorization, /^AWS4-HMAC-SHA256 /);
  });
});
