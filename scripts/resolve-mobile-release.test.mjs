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
    assert.equal(result.outputs.gradle_task, 'bundleRelease');
    assert.equal(result.outputs.android_artifact_name, 'mobile-app-1.2.3-108-internal-android.aab');
  });

  it('resolves iOS IPA builds without Android artifact inputs', () => {
    const result = runResolve({
      MOBILE_PLATFORM: 'ios',
      MOBILE_SOURCE_REF: 'mobile-v1.2.3',
      MOBILE_TARGET: 'external',
      MOBILE_BUILD_NUMBER: '109',
      SUBMIT_TO_STORE: 'true',
    });

    assert.equal(result.status, 0);
    assert.equal(result.outputs.platform, 'ios');
    assert.equal(result.outputs.release_env, 'test');
    assert.equal(result.outputs.artifact_type, 'ipa');
    assert.equal(result.outputs.gradle_task, '');
    assert.equal(result.outputs.android_artifact_name, '');
    assert.equal(result.outputs.ios_artifact_name, 'mobile-app-1.2.3-109-external-ios.ipa');
    assert.equal(result.outputs.submit_to_store, 'true');
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
