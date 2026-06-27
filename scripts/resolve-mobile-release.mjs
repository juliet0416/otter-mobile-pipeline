#!/usr/bin/env node

import { appendFileSync } from 'node:fs';

const targetConfig = {
  internal: {
    releaseEnv: 'test',
    androidTrack: 'internal',
    androidReleaseStatus: 'completed',
    prerelease: 'true',
  },
  external: {
    releaseEnv: 'test',
    androidTrack: 'beta',
    androidReleaseStatus: 'completed',
    prerelease: 'true',
  },
  production: {
    releaseEnv: 'production',
    androidTrack: 'production',
    androidReleaseStatus: 'draft',
    prerelease: 'false',
  },
  cn: {
    releaseEnv: 'production',
    androidTrack: 'internal',
    androidReleaseStatus: 'completed',
    prerelease: 'true',
    region: 'cn',
    apiBaseUrl: 'https://api.ottermind.cn/',
  },
};

const artifactConfig = {
  aab: {
    gradleTask: 'bundleRelease',
    outputGlob: 'apps/mobile/android/app/build/outputs/bundle/release/*.aab',
  },
  apk: {
    gradleTask: 'assembleRelease',
    outputGlob: 'apps/mobile/android/app/build/outputs/apk/release/*.apk',
  },
};

const artifactPrefix = readEnv('MOBILE_ARTIFACT_PREFIX', 'mobile-app');

function readEnv(name, fallback = '') {
  return process.env[name]?.trim() || fallback;
}

function readBooleanEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = raw.trim().toLowerCase();
  if (value === 'true' || value === '1' || value === 'yes') return true;
  if (value === 'false' || value === '0' || value === 'no') return false;
  fail(`${name} must be true or false, got "${raw}"`);
}

function fail(message) {
  console.error(`[resolve] ${message}`);
  process.exit(1);
}

function parseVersion(ref, explicitVersion) {
  if (explicitVersion) {
    if (!/^\d+\.\d+\.\d+$/.test(explicitVersion)) {
      fail(`version must be semver like 1.2.3, got "${explicitVersion}"`);
    }
    return explicitVersion;
  }

  const match = ref.match(/^(?:refs\/tags\/)?mobile-v(\d+\.\d+\.\d+)$/);
  if (!match) {
    fail(`cannot infer semver from ref "${ref}". Pass version explicitly.`);
  }
  return match[1];
}

function parseBuildNumber(raw, fallback) {
  const value = raw || fallback;
  if (!/^[1-9]\d*$/.test(value)) {
    fail(`build_number must be a positive integer, got "${value}"`);
  }
  return value;
}

function writeOutputs(values) {
  const outputPath = process.env.GITHUB_OUTPUT;
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`);
  if (outputPath) {
    appendFileSync(outputPath, `${lines.join('\n')}\n`);
  } else {
    console.log(lines.join('\n'));
  }
}

const sourceRef = readEnv('MOBILE_SOURCE_REF');
if (!sourceRef) {
  fail('MOBILE_SOURCE_REF is required');
}

const target = readEnv('MOBILE_TARGET', 'internal');
const config = targetConfig[target];
if (!config) {
  fail(`unknown target "${target}". Use internal, external, production, or cn.`);
}

const platform = readEnv('MOBILE_PLATFORM', 'android');
if (!['android', 'ios'].includes(platform)) {
  fail(`unknown platform "${platform}". Use android or ios.`);
}
if (platform === 'ios' && target === 'cn') {
  fail('target "cn" is only supported for platform "android".');
}

const artifactType = platform === 'ios' ? 'ipa' : readEnv('MOBILE_ARTIFACT_TYPE', 'aab');
const artifact = platform === 'android' ? artifactConfig[artifactType] : null;
if (platform === 'android') {
  if (!artifact) {
    fail(`unknown artifact_type "${artifactType}". Use aab or apk.`);
  }
  if (target === 'cn' && artifactType !== 'apk') {
    fail('target "cn" only supports artifact_type "apk".');
  }
  if (target !== 'cn' && artifactType === 'apk') {
    fail('artifact_type "apk" is only supported for target "cn".');
  }
}

const version = parseVersion(sourceRef, readEnv('MOBILE_VERSION'));
const buildNumber = parseBuildNumber(
  readEnv('MOBILE_BUILD_NUMBER'),
  readEnv('GITHUB_RUN_NUMBER', '1'),
);
const safeRef = sourceRef.replace(/^refs\/tags\//, '').replace(/[^A-Za-z0-9._-]+/g, '-');
const clearCache = readBooleanEnv('CLEAR_CACHE', false);
const submitToStore = readBooleanEnv('SUBMIT_TO_STORE', false);
if (submitToStore && platform === 'android' && artifactType !== 'aab') {
  fail('submit_to_store requires artifact_type "aab".');
}
const uploadPrivateRelease = readBooleanEnv('UPLOAD_PRIVATE_RELEASE', true);

writeOutputs({
  source_ref: sourceRef,
  safe_ref: safeRef,
  platform,
  target,
  version,
  build_number: buildNumber,
  release_env: config.releaseEnv,
  prerelease: config.prerelease,
  android_track: readEnv('ANDROID_PLAY_TRACK', config.androidTrack),
  android_release_status: readEnv('ANDROID_RELEASE_STATUS', config.androidReleaseStatus),
  expo_public_region: config.region ?? '',
  expo_public_api_base_url: config.apiBaseUrl ?? '',
  clear_cache: String(clearCache),
  submit_to_store: String(submitToStore),
  upload_private_release: String(uploadPrivateRelease),
  artifact_type: artifactType,
  gradle_task: artifact?.gradleTask ?? '',
  output_glob: artifact?.outputGlob ?? '',
  android_artifact_name: platform === 'android'
    ? `${artifactPrefix}-${version}-${buildNumber}-${target}-android.${artifactType}`
    : '',
  ios_artifact_name: `${artifactPrefix}-${version}-${buildNumber}-${target}-ios.ipa`,
});
