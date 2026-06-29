#!/usr/bin/env node

import { appendFileSync } from 'node:fs';
import { resolveStoreBuildNumber } from './resolve-store-build-number.mjs';

const targetConfig = {
  internal: {
    androidTrack: 'internal',
    androidReleaseStatus: 'completed',
    prerelease: 'true',
  },
  external: {
    androidTrack: 'beta',
    androidReleaseStatus: 'completed',
    prerelease: 'true',
  },
  production: {
    androidTrack: 'production',
    androidReleaseStatus: 'draft',
    prerelease: 'false',
  },
  cn: {
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
  return parseBooleanValue(raw, name);
}

function parseBooleanValue(raw, name) {
  if (typeof raw === 'boolean') return raw;
  const value = String(raw ?? '').trim().toLowerCase();
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

function parseBuildNumber(raw) {
  const value = raw;
  if (!/^[1-9]\d*$/.test(value)) {
    fail(`build_number must be a positive integer, got "${value}"`);
  }
  return value;
}

function parseBuildNumberOffset(raw) {
  const value = raw || '0';
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    fail(`build_number_offset must be a non-negative integer, got "${raw}"`);
  }
  return Number(value);
}

function parseReleaseItems(raw) {
  const value = raw?.trim();
  if (!value || value === 'null') return [];

  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    fail(`MOBILE_RELEASE_ITEMS must be valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!Array.isArray(parsed)) {
    fail('MOBILE_RELEASE_ITEMS must be a JSON array.');
  }
  return parsed;
}

function resolveReleaseEnv(platform) {
  const value = readEnv('MOBILE_RELEASE_ENV', 'production');
  if (value !== 'test' && value !== 'production') {
    fail(`MOBILE_RELEASE_ENV must be test or production, got "${value}"`);
  }
  if (platform === 'ios' && value !== 'production') {
    fail('iOS releases only support MOBILE_RELEASE_ENV=production.');
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

const platform = readEnv('MOBILE_PLATFORM', 'android');
if (!['android', 'ios'].includes(platform)) {
  fail(`unknown platform "${platform}". Use android or ios.`);
}

const defaultTarget = platform === 'ios' ? 'production' : 'internal';
const target = readEnv('MOBILE_TARGET', defaultTarget);
const config = targetConfig[target];
if (!config) {
  fail(`unknown target "${target}". Use internal, external, production, or cn.`);
}
if (platform === 'ios' && target === 'cn') {
  fail('target "cn" is only supported for platform "android".');
}
if (platform === 'ios' && target !== 'production') {
  fail('iOS releases only support target "production".');
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
const releaseEnv = resolveReleaseEnv(platform);
const safeRef = sourceRef.replace(/^refs\/tags\//, '').replace(/[^A-Za-z0-9._-]+/g, '-');
const clearCache = readBooleanEnv('CLEAR_CACHE', false);
const uploadPrivateRelease = readBooleanEnv('UPLOAD_PRIVATE_RELEASE', true);
const explicitBuildNumber = readEnv('MOBILE_BUILD_NUMBER');
const releaseItems = parseReleaseItems(readEnv('MOBILE_RELEASE_ITEMS'));
const defaultSubmitToStore = readBooleanEnv('SUBMIT_TO_STORE', false);
const defaultItem = {
  target,
  artifact_type: artifactType,
  build_number_offset: readEnv('MOBILE_BUILD_NUMBER_OFFSET', '0'),
  submit: defaultSubmitToStore,
};
const rawItems = releaseItems.length > 0 ? releaseItems : [defaultItem];

async function resolveBuildNumberForOffset(offset) {
  if (explicitBuildNumber) return parseBuildNumber(explicitBuildNumber);
  return parseBuildNumber(await (async () => {
    try {
      return await resolveStoreBuildNumber({
        platform,
        offset,
      });
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
    }
  })());
}

async function resolveItem(rawItem, index) {
  if (rawItem === null || typeof rawItem !== 'object' || Array.isArray(rawItem)) {
    fail(`MOBILE_RELEASE_ITEMS[${index}] must be an object.`);
  }

  const itemTarget = String(rawItem.target ?? target);
  const itemConfig = targetConfig[itemTarget];
  if (!itemConfig) {
    fail(`unknown target "${itemTarget}". Use internal, external, production, or cn.`);
  }
  if (platform === 'ios' && itemTarget === 'cn') {
    fail('target "cn" is only supported for platform "android".');
  }
  if (platform === 'ios' && itemTarget !== 'production') {
    fail('iOS releases only support target "production".');
  }

  const itemArtifactType = platform === 'ios' ? 'ipa' : String(rawItem.artifact_type ?? artifactType);
  const itemArtifact = platform === 'android' ? artifactConfig[itemArtifactType] : null;
  if (platform === 'android') {
    if (!itemArtifact) {
      fail(`unknown artifact_type "${itemArtifactType}". Use aab or apk.`);
    }
    if (itemTarget === 'cn' && itemArtifactType !== 'apk') {
      fail('target "cn" only supports artifact_type "apk".');
    }
    if (itemTarget !== 'cn' && itemArtifactType === 'apk') {
      fail('artifact_type "apk" is only supported for target "cn".');
    }
  }

  const itemSubmitToStore = rawItem.submit === undefined
    ? defaultSubmitToStore
    : parseBooleanValue(rawItem.submit, `MOBILE_RELEASE_ITEMS[${index}].submit`);
  if (itemSubmitToStore && platform === 'android' && itemArtifactType !== 'aab') {
    fail('submit_to_store requires artifact_type "aab".');
  }

  const itemOffset = parseBuildNumberOffset(String(rawItem.build_number_offset ?? readEnv('MOBILE_BUILD_NUMBER_OFFSET', '0')));
  const buildNumber = await resolveBuildNumberForOffset(itemOffset);
  const artifactName = platform === 'android'
    ? `${artifactPrefix}-${version}-${buildNumber}-${itemTarget}-android.${itemArtifactType}`
    : `${artifactPrefix}-${version}-${buildNumber}-${itemTarget}-ios.ipa`;

  return {
    source_ref: sourceRef,
    safe_ref: safeRef,
    platform,
    target: itemTarget,
    version,
    build_number: buildNumber,
    build_number_offset: String(itemOffset),
    release_env: releaseEnv,
    prerelease: itemConfig.prerelease,
    android_track: readEnv('ANDROID_PLAY_TRACK', itemConfig.androidTrack),
    android_release_status: readEnv('ANDROID_RELEASE_STATUS', itemConfig.androidReleaseStatus),
    expo_public_region: itemConfig.region ?? '',
    expo_public_api_base_url: itemConfig.apiBaseUrl ?? '',
    clear_cache: String(clearCache),
    submit_to_store: String(itemSubmitToStore),
    upload_private_release: String(uploadPrivateRelease),
    artifact_type: itemArtifactType,
    gradle_task: itemArtifact?.gradleTask ?? '',
    output_glob: itemArtifact?.outputGlob ?? '',
    artifact_name: artifactName,
  };
}

const resolvedItems = [];
for (let index = 0; index < rawItems.length; index += 1) {
  resolvedItems.push(await resolveItem(rawItems[index], index));
}
const firstItem = resolvedItems[0];
const submitItems = resolvedItems.filter((item) => item.submit_to_store === 'true');

if (!firstItem) {
  fail('release item list is empty.');
}

writeOutputs({
  source_ref: sourceRef,
  safe_ref: safeRef,
  platform,
  target: firstItem.target,
  version,
  build_number: firstItem.build_number,
  release_env: releaseEnv,
  prerelease: firstItem.prerelease,
  android_track: firstItem.android_track,
  android_release_status: firstItem.android_release_status,
  expo_public_region: firstItem.expo_public_region,
  expo_public_api_base_url: firstItem.expo_public_api_base_url,
  clear_cache: String(clearCache),
  submit_to_store: String(submitItems.length > 0),
  upload_private_release: String(uploadPrivateRelease),
  artifact_type: firstItem.artifact_type,
  gradle_task: firstItem.gradle_task,
  output_glob: firstItem.output_glob,
  android_artifact_name: platform === 'android' ? firstItem.artifact_name : '',
  ios_artifact_name: platform === 'ios' ? firstItem.artifact_name : '',
  matrix: JSON.stringify(resolvedItems),
  submit_matrix: JSON.stringify(submitItems),
  has_submit: String(submitItems.length > 0),
});
