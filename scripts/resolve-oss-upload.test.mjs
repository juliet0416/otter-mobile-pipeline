import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  buildOssObjectKey,
  buildOssUploadName,
  resolveOssUpload,
} from './resolve-oss-upload.mjs';

describe('resolve-oss-upload', () => {
  test('uploads only China APK artifacts', () => {
    const result = resolveOssUpload({
      artifactName: 'mobile-app-1.0.3-130-cn-android.apk',
      artifactPath: '.private/artifacts/mobile-app-1.0.3-130-cn-android.apk',
      artifactType: 'apk',
      accessKeyId: 'ak',
      accessKeySecret: 'sk',
      bucket: 'chat2db-cdn',
      endpoint: 'oss-cn-hangzhou.aliyuncs.com',
      prefix: 'ottermind/mobile/android',
      publicBaseUrl: 'https://cdn.example.com',
      target: 'cn',
      version: '1.0.3',
      buildNumber: '130',
    });

    assert.equal(result.enabled, true);
    assert.equal(result.uploadName, 'ottermind_Android_1.0.3-130.apk');
    assert.equal(result.objectKey, 'ottermind/mobile/android/ottermind_Android_1.0.3-130.apk');
    assert.equal(result.destination, 'oss://chat2db-cdn/ottermind/mobile/android/ottermind_Android_1.0.3-130.apk');
    assert.equal(result.publicUrl, 'https://cdn.example.com/ottermind/mobile/android/ottermind_Android_1.0.3-130.apk');
  });

  test('skips non-China targets', () => {
    const result = resolveOssUpload({
      artifactName: 'mobile-app-1.0.3-130-internal-android.aab',
      artifactPath: '.private/artifacts/mobile-app-1.0.3-130-internal-android.aab',
      artifactType: 'aab',
      accessKeyId: 'ak',
      accessKeySecret: 'sk',
      bucket: 'mobile-release',
      endpoint: 'oss-cn-hangzhou.aliyuncs.com',
      prefix: 'ottermind/android',
      target: 'internal',
      version: '1.0.3',
    });

    assert.equal(result.enabled, false);
    assert.equal(result.reason, 'OSS upload only supports target=cn artifact_type=apk');
  });

  test('skips when OSS config is missing', () => {
    const result = resolveOssUpload({
      artifactName: 'mobile-app-1.0.3-130-cn-android.apk',
      artifactPath: '.private/artifacts/mobile-app-1.0.3-130-cn-android.apk',
      artifactType: 'apk',
      accessKeyId: 'ak',
      accessKeySecret: 'sk',
      bucket: '',
      endpoint: '',
      target: 'cn',
      version: '1.0.3',
    });

    assert.equal(result.enabled, false);
    assert.equal(result.reason, 'OSS bucket or endpoint is not configured');
  });

  test('skips when OSS credentials are missing', () => {
    const result = resolveOssUpload({
      artifactName: 'mobile-app-1.0.3-130-cn-android.apk',
      artifactPath: '.private/artifacts/mobile-app-1.0.3-130-cn-android.apk',
      artifactType: 'apk',
      accessKeyId: '',
      accessKeySecret: '',
      bucket: 'mobile-release',
      endpoint: 'oss-cn-hangzhou.aliyuncs.com',
      target: 'cn',
      version: '1.0.3',
    });

    assert.equal(result.enabled, false);
    assert.equal(result.reason, 'OSS credentials are not configured');
  });

  test('normalizes object key slashes', () => {
    assert.equal(
      buildOssObjectKey({
        uploadName: 'ottermind_Android_1.0.3-130.apk',
        prefix: '/ottermind/mobile/android/',
        version: '1.0.3',
      }),
      'ottermind/mobile/android/ottermind_Android_1.0.3-130.apk',
    );
  });

  test('derives legacy OSS upload name from version and build number', () => {
    const result = resolveOssUpload({
      artifactName: 'mobile-app-1.0.1-104-cn-android.apk',
      artifactPath: '.private/artifacts/mobile-app-1.0.1-104-cn-android.apk',
      artifactType: 'apk',
      accessKeyId: 'ak',
      accessKeySecret: 'sk',
      bucket: 'chat2db-cdn',
      buildNumber: '104',
      endpoint: 'oss-cn-hangzhou.aliyuncs.com',
      prefix: 'ottermind/mobile/android',
      target: 'cn',
      version: '1.0.1',
    });

    assert.equal(result.uploadName, 'ottermind_Android_1.0.1-104.apk');
  });

  test('builds legacy OSS upload name', () => {
    assert.equal(
      buildOssUploadName({ version: '1.0.1', buildNumber: '104' }),
      'ottermind_Android_1.0.1-104.apk',
    );
  });
});
