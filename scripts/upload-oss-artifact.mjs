#!/usr/bin/env node

import { createReadStream, statSync } from 'node:fs';
import { createHmac } from 'node:crypto';

const APK_CONTENT_TYPE = 'application/vnd.android.package-archive';

function fail(message) {
  throw new Error(message);
}

function normalizeEndpoint(endpoint) {
  const value = String(endpoint ?? '').trim();
  if (!value) return '';
  return value.startsWith('http://') || value.startsWith('https://') ? value : `https://${value}`;
}

export function encodeObjectKey(objectKey) {
  return String(objectKey ?? '')
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

export function buildOssAuthorization({
  accessKeyId,
  accessKeySecret,
  bucket,
  contentType,
  date,
  objectKey,
}) {
  const canonicalizedResource = `/${bucket}/${objectKey}`;
  const stringToSign = [
    'PUT',
    '',
    contentType,
    date,
    canonicalizedResource,
  ].join('\n');
  const signature = createHmac('sha1', accessKeySecret).update(stringToSign).digest('base64');
  return `OSS ${accessKeyId}:${signature}`;
}

export function buildOssUploadRequest({
  accessKeyId,
  accessKeySecret,
  bucket,
  contentLength,
  endpoint,
  objectKey,
  now = () => new Date(),
}) {
  const normalizedEndpoint = normalizeEndpoint(endpoint);
  if (!normalizedEndpoint) fail('OSS endpoint is required');

  const endpointUrl = new URL(normalizedEndpoint);
  const date = now().toUTCString();
  const contentType = APK_CONTENT_TYPE;
  const host = `${bucket}.${endpointUrl.host}`;
  const url = `${endpointUrl.protocol}//${host}/${encodeObjectKey(objectKey)}`;

  return {
    headers: {
      Authorization: buildOssAuthorization({
        accessKeyId,
        accessKeySecret,
        bucket,
        contentType,
        date,
        objectKey,
      }),
      'Content-Length': contentLength,
      'Content-Type': contentType,
      Date: date,
      Host: host,
    },
    url,
  };
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) fail(`${name} is required`);
  return value;
}

async function uploadOssArtifact({
  accessKeyId,
  accessKeySecret,
  bucket,
  endpoint,
  objectKey,
  source,
}) {
  const stat = statSync(source);
  const request = buildOssUploadRequest({
    accessKeyId,
    accessKeySecret,
    bucket,
    contentLength: stat.size,
    endpoint,
    objectKey,
  });

  const response = await fetch(request.url, {
    method: 'PUT',
    headers: request.headers,
    body: createReadStream(source),
    duplex: 'half',
  });
  const responseText = await response.text().catch(() => '');
  if (!response.ok) {
    fail(`OSS upload failed with ${response.status}: ${responseText}`);
  }

  console.log(`[oss] uploaded ${source} -> oss://${bucket}/${objectKey}`);
}

async function main() {
  await uploadOssArtifact({
    accessKeyId: requireEnv('OSS_ACCESS_KEY_ID'),
    accessKeySecret: requireEnv('OSS_ACCESS_KEY_SECRET'),
    bucket: requireEnv('OSS_BUCKET'),
    endpoint: requireEnv('OSS_ENDPOINT'),
    objectKey: requireEnv('OSS_OBJECT_KEY'),
    source: requireEnv('OSS_SOURCE'),
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
