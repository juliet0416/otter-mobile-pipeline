#!/usr/bin/env node

import { appendFileSync } from 'node:fs';

function trimSlashes(value) {
  return String(value ?? '').replace(/^\/+|\/+$/g, '');
}

function compact(values) {
  return values.filter((value) => value !== undefined && value !== null && value !== '');
}

function buildPublicUrl(baseUrl, objectKey) {
  if (!baseUrl) return '';
  return `${String(baseUrl).replace(/\/+$/g, '')}/${objectKey}`;
}

export function buildOssUploadName({ buildNumber, version }) {
  if (!version || !buildNumber) return '';
  return `ottermind_Android_${version}-${buildNumber}.apk`;
}

export function buildOssObjectKey({ prefix, uploadName }) {
  return compact([
    trimSlashes(prefix),
    trimSlashes(uploadName),
  ]).join('/');
}

export function resolveOssUpload(input) {
  if (input.target !== 'cn' || input.artifactType !== 'apk') {
    return {
      enabled: false,
      reason: 'OSS upload only supports target=cn artifact_type=apk',
    };
  }

  if (!input.bucket || !input.endpoint) {
    return {
      enabled: false,
      reason: 'OSS bucket or endpoint is not configured',
    };
  }

  if (!input.accessKeyId || !input.accessKeySecret) {
    return {
      enabled: false,
      reason: 'OSS credentials are not configured',
    };
  }

  if (!input.artifactName || !input.artifactPath) {
    return {
      enabled: false,
      reason: 'OSS artifact name or path is missing',
    };
  }
  if (!input.version || !input.buildNumber) {
    return {
      enabled: false,
      reason: 'OSS upload version or build number is missing',
    };
  }

  const uploadName = buildOssUploadName({
    buildNumber: input.buildNumber,
    version: input.version,
  });
  const objectKey = buildOssObjectKey({
    prefix: input.prefix,
    uploadName,
  });

  return {
    bucket: input.bucket,
    destination: `oss://${input.bucket}/${objectKey}`,
    enabled: true,
    endpoint: input.endpoint,
    objectKey,
    publicUrl: buildPublicUrl(input.publicBaseUrl, objectKey),
    source: input.artifactPath,
    uploadName,
  };
}

function writeOutput(name, value) {
  console.log(`${name}=${value}`);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
  }
}

async function main() {
  const result = resolveOssUpload({
    artifactName: process.env.OSS_ARTIFACT_NAME,
    artifactPath: process.env.OSS_ARTIFACT_PATH,
    artifactType: process.env.OSS_ARTIFACT_TYPE,
    accessKeyId: process.env.OSS_ACCESS_KEY_ID,
    accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
    buildNumber: process.env.OSS_BUILD_NUMBER,
    bucket: process.env.OSS_BUCKET,
    endpoint: process.env.OSS_ENDPOINT,
    prefix: process.env.OSS_PREFIX,
    publicBaseUrl: process.env.OSS_PUBLIC_BASE_URL,
    target: process.env.OSS_TARGET,
    version: process.env.OSS_VERSION,
  });

  writeOutput('enabled', String(result.enabled));
  writeOutput('reason', result.reason ?? '');
  writeOutput('source', result.source ?? '');
  writeOutput('destination', result.destination ?? '');
  writeOutput('endpoint', result.endpoint ?? '');
  writeOutput('object_key', result.objectKey ?? '');
  writeOutput('public_url', result.publicUrl ?? '');
  writeOutput('upload_name', result.uploadName ?? '');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
