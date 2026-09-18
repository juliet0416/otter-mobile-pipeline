#!/usr/bin/env node

import { appendFileSync } from 'node:fs';

function trimSlashes(value) {
  return String(value ?? '').replace(/^\/+|\/+$/g, '');
}

function buildPublicUrl(baseUrl, objectKey) {
  if (!baseUrl) return '';
  return `${String(baseUrl).replace(/\/+$/g, '')}/${objectKey}`;
}

export function buildR2UploadName({ buildNumber, target, version }) {
  if (!version || !buildNumber) return '';
  const prefix = target === 'production' ? 'ottermind_Android_global_' : 'ottermind_Android_';
  return `${prefix}${version}-${buildNumber}.apk`;
}

export function buildR2ObjectKey({ prefix, uploadName }) {
  return [trimSlashes(prefix), trimSlashes(uploadName)].filter(Boolean).join('/');
}

export function resolveR2Upload(input) {
  if (!['cn', 'production'].includes(input.target) || input.artifactType !== 'apk') {
    return { enabled: false, reason: 'R2 upload only supports target=cn|production artifact_type=apk' };
  }
  if (!input.bucket || !input.endpoint) {
    return { enabled: false, reason: 'R2 bucket or endpoint is not configured' };
  }
  if (!input.accessKeyId || !input.accessKeySecret) {
    return { enabled: false, reason: 'R2 credentials are not configured' };
  }
  if (!input.artifactName || !input.artifactPath) {
    return { enabled: false, reason: 'R2 artifact name or path is missing' };
  }
  if (!input.version || !input.buildNumber) {
    return { enabled: false, reason: 'R2 upload version or build number is missing' };
  }

  const uploadName = buildR2UploadName({ buildNumber: input.buildNumber, target: input.target, version: input.version });
  const objectKey = buildR2ObjectKey({ prefix: input.prefix, uploadName });
  const latestName = input.target === 'production'
    ? 'ottermind_Android_global_latest.apk'
    : 'ottermind_Android_latest.apk';
  const latestObjectKey = buildR2ObjectKey({ prefix: input.prefix, uploadName: latestName });
  return {
    bucket: input.bucket,
    destination: `r2://${input.bucket}/${objectKey}`,
    enabled: true,
    endpoint: input.endpoint,
    latestDestination: `r2://${input.bucket}/${latestObjectKey}`,
    latestObjectKey,
    latestPublicUrl: buildPublicUrl(input.publicBaseUrl, latestObjectKey),
    objectKey,
    publicUrl: buildPublicUrl(input.publicBaseUrl, objectKey),
    source: input.artifactPath,
    uploadName,
  };
}

function writeOutput(name, value) {
  console.log(`${name}=${value}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

async function main() {
  const result = resolveR2Upload({
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    accessKeySecret: process.env.R2_SECRET_ACCESS_KEY,
    artifactName: process.env.R2_ARTIFACT_NAME,
    artifactPath: process.env.R2_ARTIFACT_PATH,
    artifactType: process.env.R2_ARTIFACT_TYPE,
    buildNumber: process.env.R2_BUILD_NUMBER,
    bucket: process.env.R2_BUCKET_NAME,
    endpoint: process.env.R2_ENDPOINT,
    prefix: process.env.R2_OBJECT_PREFIX,
    publicBaseUrl: process.env.R2_PUBLIC_BASE_URL,
    target: process.env.R2_TARGET,
    version: process.env.R2_VERSION,
  });
  writeOutput('enabled', String(result.enabled));
  writeOutput('reason', result.reason ?? '');
  writeOutput('source', result.source ?? '');
  writeOutput('destination', result.destination ?? '');
  writeOutput('endpoint', result.endpoint ?? '');
  writeOutput('object_key', result.objectKey ?? '');
  writeOutput('latest_destination', result.latestDestination ?? '');
  writeOutput('latest_object_key', result.latestObjectKey ?? '');
  writeOutput('public_url', result.publicUrl ?? '');
  writeOutput('latest_public_url', result.latestPublicUrl ?? '');
  writeOutput('upload_name', result.uploadName ?? '');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
