import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  buildR2ObjectKey,
  buildR2UploadName,
  resolveR2Upload,
} from './resolve-oss-upload.mjs';

describe('resolve-r2-upload', () => {
  test('uploads China APK artifacts with the CN naming', () => {
    const result = resolveR2Upload({
      artifactName: 'mobile-app-1.0.3-130-cn-android.apk',
      artifactPath: '.private/artifacts/mobile-app-1.0.3-130-cn-android.apk',
      artifactType: 'apk',
      accessKeyId: 'ak',
      accessKeySecret: 'sk',
      bucket: 'ottermind',
      endpoint: 'https://account.r2.cloudflarestorage.com',
      prefix: 'mobile/appUpdate',
      publicBaseUrl: 'https://cdn.ottermind.ai',
      target: 'cn',
      version: '1.0.3',
      buildNumber: '130',
    });

    assert.equal(result.enabled, true);
    assert.equal(result.uploadName, 'ottermind_Android_1.0.3-130.apk');
    assert.equal(result.objectKey, 'mobile/appUpdate/ottermind_Android_1.0.3-130.apk');
    assert.equal(result.latestObjectKey, 'mobile/appUpdate/ottermind_Android_latest.apk');
    assert.equal(result.destination, 'r2://ottermind/mobile/appUpdate/ottermind_Android_1.0.3-130.apk');
    assert.equal(result.latestDestination, 'r2://ottermind/mobile/appUpdate/ottermind_Android_latest.apk');
    assert.equal(result.publicUrl, 'https://cdn.ottermind.ai/mobile/appUpdate/ottermind_Android_1.0.3-130.apk');
    assert.equal(result.latestPublicUrl, 'https://cdn.ottermind.ai/mobile/appUpdate/ottermind_Android_latest.apk');
  });

  test('uploads global APK artifacts with an independent latest object', () => {
    const result = resolveR2Upload({
      artifactName: 'mobile-app-1.0.3-130-production-android.apk',
      artifactPath: '.private/artifacts/mobile-app-1.0.3-130-production-android.apk',
      artifactType: 'apk',
      accessKeyId: 'ak',
      accessKeySecret: 'sk',
      bucket: 'ottermind',
      endpoint: 'https://account.r2.cloudflarestorage.com',
      prefix: 'mobile/appUpdate',
      publicBaseUrl: 'https://cdn.ottermind.ai',
      target: 'production',
      version: '1.0.3',
      buildNumber: '130',
    });

    assert.equal(result.enabled, true);
    assert.equal(result.uploadName, 'ottermind_Android_global_1.0.3-130.apk');
    assert.equal(result.objectKey, 'mobile/appUpdate/ottermind_Android_global_1.0.3-130.apk');
    assert.equal(result.latestObjectKey, 'mobile/appUpdate/ottermind_Android_global_latest.apk');
    assert.equal(result.latestPublicUrl, 'https://cdn.ottermind.ai/mobile/appUpdate/ottermind_Android_global_latest.apk');
  });

  test('skips non-APK targets', () => {
    const result = resolveR2Upload({
      artifactName: 'mobile-app-1.0.3-130-internal-android.aab',
      artifactPath: '.private/artifacts/mobile-app-1.0.3-130-internal-android.aab',
      artifactType: 'aab',
      accessKeyId: 'ak',
      accessKeySecret: 'sk',
      bucket: 'mobile-release',
      endpoint: 'https://account.r2.cloudflarestorage.com',
      prefix: 'ottermind/android',
      target: 'internal',
      version: '1.0.3',
    });

    assert.equal(result.enabled, false);
    assert.equal(result.reason, 'R2 upload only supports target=cn|production artifact_type=apk');
  });

  test('skips when OSS config is missing', () => {
    const result = resolveR2Upload({
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
    assert.equal(result.reason, 'R2 bucket or endpoint is not configured');
  });

  test('skips when OSS credentials are missing', () => {
    const result = resolveR2Upload({
      artifactName: 'mobile-app-1.0.3-130-cn-android.apk',
      artifactPath: '.private/artifacts/mobile-app-1.0.3-130-cn-android.apk',
      artifactType: 'apk',
      accessKeyId: '',
      accessKeySecret: '',
      bucket: 'mobile-release',
      endpoint: 'https://account.r2.cloudflarestorage.com',
      target: 'cn',
      version: '1.0.3',
    });

    assert.equal(result.enabled, false);
    assert.equal(result.reason, 'R2 credentials are not configured');
  });

  test('normalizes object key slashes', () => {
    assert.equal(
      buildR2ObjectKey({
        uploadName: 'ottermind_Android_1.0.3-130.apk',
        prefix: '/mobile/appUpdate/',
        version: '1.0.3',
      }),
      'mobile/appUpdate/ottermind_Android_1.0.3-130.apk',
    );
  });

  test('derives R2 upload name from version and build number', () => {
    const result = resolveR2Upload({
      artifactName: 'mobile-app-1.0.1-104-cn-android.apk',
      artifactPath: '.private/artifacts/mobile-app-1.0.1-104-cn-android.apk',
      artifactType: 'apk',
      accessKeyId: 'ak',
      accessKeySecret: 'sk',
      bucket: 'ottermind',
      buildNumber: '104',
      endpoint: 'https://account.r2.cloudflarestorage.com',
      prefix: 'mobile/appUpdate',
      target: 'cn',
      version: '1.0.1',
    });

    assert.equal(result.uploadName, 'ottermind_Android_1.0.1-104.apk');
  });

  test('builds R2 upload name', () => {
    assert.equal(
      buildR2UploadName({ target: 'cn', version: '1.0.1', buildNumber: '104' }),
      'ottermind_Android_1.0.1-104.apk',
    );
    assert.equal(
      buildR2UploadName({ target: 'production', version: '1.0.1', buildNumber: '104' }),
      'ottermind_Android_global_1.0.1-104.apk',
    );
  });
});
