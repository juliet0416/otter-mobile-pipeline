import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

function runResolve(env = {}) {
  const result = spawnSync('node', ['scripts/resolve-mobile-release.mjs'], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
    env: {
      ...process.env,
      GITHUB_OUTPUT: '',
      ...env,
    },
  });
  return {
    ...result,
    outputs: parseOutputs(result.stdout),
  };
}

function parseOutputs(text) {
  return Object.fromEntries(
    text
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const index = line.indexOf('=');
        return [line.slice(0, index), line.slice(index + 1)];
      }),
  );
}

describe('resolve-mobile-release', () => {
  it('resolves Android AAB builds by default', () => {
    const result = runResolve({
      MOBILE_SOURCE_REF: 'mobile-v1.2.3',
      MOBILE_TARGET: 'internal',
      MOBILE_BUILD_NUMBER: '108',
    });

    assert.equal(result.status, 0);
    assert.equal(result.outputs.platform, 'android');
    assert.equal(result.outputs.artifact_type, 'aab');
    assert.equal(result.outputs.release_env, 'production');
    assert.equal(result.outputs.android_track, 'internal');
    assert.equal(result.outputs.gradle_task, 'bundleRelease');
    assert.equal(result.outputs.android_artifact_name, 'mobile-app-1.2.3-108-internal-android.aab');
  });

  it('keeps Play testing track separate from Android release environment', () => {
    const result = runResolve({
      MOBILE_SOURCE_REF: 'mobile-v1.2.3',
      MOBILE_TARGET: 'internal',
      MOBILE_RELEASE_ENV: 'test',
      MOBILE_BUILD_NUMBER: '108',
    });

    assert.equal(result.status, 0);
    assert.equal(result.outputs.target, 'internal');
    assert.equal(result.outputs.release_env, 'test');
    assert.equal(result.outputs.android_track, 'internal');
  });

  it('rejects invalid Android release environments', () => {
    const result = runResolve({
      MOBILE_SOURCE_REF: 'mobile-v1.2.3',
      MOBILE_TARGET: 'internal',
      MOBILE_RELEASE_ENV: 'staging',
      MOBILE_BUILD_NUMBER: '108',
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /MOBILE_RELEASE_ENV must be test or production/);
  });

  it('keeps explicit Android build numbers without querying the store', () => {
    const result = runResolve({
      MOBILE_SOURCE_REF: 'mobile-v1.2.3',
      MOBILE_TARGET: 'internal',
      MOBILE_BUILD_NUMBER: '108',
      MOBILE_BUILD_NUMBER_OFFSET: '9',
    });

    assert.equal(result.status, 0);
    assert.equal(result.outputs.build_number, '108');
    assert.equal(result.outputs.android_artifact_name, 'mobile-app-1.2.3-108-internal-android.aab');
  });

  it('auto resolves Android versionCode from Google Play tracks plus offset', () => {
    const result = runResolve({
      MOBILE_SOURCE_REF: 'mobile-v1.2.3',
      MOBILE_TARGET: 'internal',
      MOBILE_BUILD_NUMBER_OFFSET: '2',
      STORE_ANDROID_TRACKS_JSON: JSON.stringify({
        tracks: [
          {
            track: 'internal',
            releases: [{ versionCodes: ['104', '107'] }],
          },
          {
            track: 'production',
            releases: [{ versionCodes: ['106'] }],
          },
        ],
      }),
    });

    assert.equal(result.status, 0);
    assert.equal(result.outputs.build_number, '110');
    assert.equal(result.outputs.android_artifact_name, 'mobile-app-1.2.3-110-internal-android.aab');
  });

  it('resolves iOS IPA builds without Android artifact inputs', () => {
    const result = runResolve({
      MOBILE_PLATFORM: 'ios',
      MOBILE_SOURCE_REF: 'mobile-v1.2.3',
      MOBILE_TARGET: 'production',
      MOBILE_BUILD_NUMBER: '109',
      CLEAR_CACHE: 'true',
      SUBMIT_TO_STORE: 'true',
    });

    assert.equal(result.status, 0);
    assert.equal(result.outputs.platform, 'ios');
    assert.equal(result.outputs.release_env, 'production');
    assert.equal(result.outputs.artifact_type, 'ipa');
    assert.equal(result.outputs.gradle_task, '');
    assert.equal(result.outputs.android_artifact_name, '');
    assert.equal(result.outputs.ios_artifact_name, 'mobile-app-1.2.3-109-production-ios.ipa');
    assert.equal(result.outputs.clear_cache, 'true');
    assert.equal(result.outputs.submit_to_store, 'true');
  });

  it('defaults iOS target to production', () => {
    const result = runResolve({
      MOBILE_PLATFORM: 'ios',
      MOBILE_SOURCE_REF: 'mobile-v1.2.3',
      MOBILE_BUILD_NUMBER: '109',
    });

    assert.equal(result.status, 0);
    assert.equal(result.outputs.target, 'production');
    assert.equal(result.outputs.ios_artifact_name, 'mobile-app-1.2.3-109-production-ios.ipa');
  });

  it('rejects non-production targets for iOS', () => {
    const result = runResolve({
      MOBILE_PLATFORM: 'ios',
      MOBILE_SOURCE_REF: 'mobile-v1.2.3',
      MOBILE_TARGET: 'internal',
      MOBILE_BUILD_NUMBER: '109',
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /iOS releases only support target "production"/);
  });

  it('rejects non-production release environments for iOS', () => {
    const result = runResolve({
      MOBILE_PLATFORM: 'ios',
      MOBILE_SOURCE_REF: 'mobile-v1.2.3',
      MOBILE_TARGET: 'production',
      MOBILE_RELEASE_ENV: 'test',
      MOBILE_BUILD_NUMBER: '109',
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /iOS releases only support MOBILE_RELEASE_ENV=production/);
  });

  it('auto resolves iOS CFBundleVersion from App Store Connect builds plus offset', () => {
    const result = runResolve({
      MOBILE_PLATFORM: 'ios',
      MOBILE_SOURCE_REF: 'mobile-v1.2.3',
      MOBILE_TARGET: 'production',
      MOBILE_BUILD_NUMBER_OFFSET: '1',
      STORE_IOS_BUILDS_JSON: JSON.stringify({
        data: [
          { attributes: { version: '124' } },
          { attributes: { version: 'not-a-number' } },
          { attributes: { version: '120' } },
        ],
      }),
    });

    assert.equal(result.status, 0);
    assert.equal(result.outputs.build_number, '126');
    assert.equal(result.outputs.ios_artifact_name, 'mobile-app-1.2.3-126-production-ios.ipa');
    assert.match(result.stderr, /Ignoring non-numeric iOS build version/);
  });

  it('fails early when automatic Android build number lookup has no credentials', () => {
    const result = runResolve({
      MOBILE_SOURCE_REF: 'mobile-v1.2.3',
      MOBILE_TARGET: 'internal',
      SUBMIT_TO_STORE: 'true',
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64/);
  });

  it('fails early when automatic iOS build number lookup has no credentials', () => {
    const result = runResolve({
      MOBILE_PLATFORM: 'ios',
      MOBILE_SOURCE_REF: 'mobile-v1.2.3',
      MOBILE_TARGET: 'production',
      SUBMIT_TO_STORE: 'true',
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /ASC_API_KEY_P8_BASE64/);
  });

  it('rejects the China target for iOS', () => {
    const result = runResolve({
      MOBILE_PLATFORM: 'ios',
      MOBILE_SOURCE_REF: 'mobile-v1.2.3',
      MOBILE_TARGET: 'cn',
      MOBILE_BUILD_NUMBER: '109',
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /target "cn" is only supported/);
  });

  it('keeps Android APK limited to the China target', () => {
    const result = runResolve({
      MOBILE_SOURCE_REF: 'mobile-v1.2.3',
      MOBILE_TARGET: 'production',
      MOBILE_ARTIFACT_TYPE: 'apk',
      MOBILE_BUILD_NUMBER: '109',
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /artifact_type "apk" is only supported/);
  });
});
