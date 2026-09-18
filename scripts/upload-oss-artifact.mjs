#!/usr/bin/env node

import { createReadStream, statSync } from 'node:fs';
import { createHmac, createHash } from 'node:crypto';

const APK_CONTENT_TYPE = 'application/vnd.android.package-archive';
const R2_REGION = 'auto';
const R2_SERVICE = 's3';
const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD';

function fail(message) {
  throw new Error(message);
}

function hmac(key, value) {
  return createHmac('sha256', key).update(value).digest();
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

function encodePath(path) {
  return String(path ?? '')
    .split('/')
    .map((segment) => encodeURIComponent(segment).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`))
    .join('/');
}

export function encodeObjectKey(objectKey) {
  return encodePath(objectKey);
}

function buildCanonicalHeaders(headers) {
  const entries = Object.entries(headers)
    .map(([name, value]) => [name.toLowerCase(), String(value).trim().replace(/\s+/g, ' ')])
    .sort(([left], [right]) => left.localeCompare(right));
  return {
    canonical: entries.map(([name, value]) => `${name}:${value}\n`).join(''),
    signed: entries.map(([name]) => name).join(';'),
  };
}

function buildSignature({ accessKeyId, accessKeySecret, accountId, bucket, contentLength, contentType, cacheControl, objectKey, now }) {
  const amzDate = now().toISOString().replace(/[-:]|\.\d{3}/g, '');
  const shortDate = amzDate.slice(0, 8);
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const canonicalUri = `/${encodePath(bucket)}/${encodePath(objectKey)}`;
  const headers = {
    'cache-control': cacheControl,
    'content-length': contentLength,
    'content-type': contentType,
    host,
    'x-amz-content-sha256': UNSIGNED_PAYLOAD,
    'x-amz-date': amzDate,
  };
  const canonical = buildCanonicalHeaders(headers);
  const canonicalRequest = [
    'PUT', canonicalUri, '', canonical.canonical, canonical.signed, UNSIGNED_PAYLOAD,
  ].join('\n');
  const scope = `${shortDate}/${R2_REGION}/${R2_SERVICE}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, hash(canonicalRequest)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${accessKeySecret}`, shortDate), R2_REGION), R2_SERVICE), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  return {
    authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${canonical.signed}, Signature=${signature}`,
    headers: {
      'Cache-Control': cacheControl,
      'Content-Length': contentLength,
      'Content-Type': contentType,
      Host: host,
      'x-amz-content-sha256': UNSIGNED_PAYLOAD,
      'x-amz-date': amzDate,
    },
  };
}

export function buildR2Authorization(options) {
  return buildSignature(options).authorization;
}

export function buildR2UploadRequest({
  accessKeyId,
  accessKeySecret,
  accountId,
  bucket,
  cacheControl,
  contentLength,
  contentType = APK_CONTENT_TYPE,
  objectKey,
  now = () => new Date(),
}) {
  if (!accountId) fail('R2 account id is required');
  const signature = buildSignature({ accessKeyId, accessKeySecret, accountId, bucket, cacheControl, contentLength, contentType, objectKey, now });
  return {
    headers: { ...signature.headers, Authorization: signature.authorization },
    url: `https://${accountId}.r2.cloudflarestorage.com/${encodePath(bucket)}/${encodePath(objectKey)}`,
  };
}

async function uploadR2Object({ accessKeyId, accessKeySecret, accountId, bucket, cacheControl, objectKey, source }) {
  const stat = statSync(source);
  const request = buildR2UploadRequest({ accessKeyId, accessKeySecret, accountId, bucket, cacheControl, contentLength: stat.size, objectKey, source });
  const response = await fetch(request.url, {
    method: 'PUT', headers: request.headers, body: createReadStream(source), duplex: 'half',
  });
  const responseText = await response.text().catch(() => '');
  if (!response.ok) fail(`R2 upload failed for ${objectKey} with ${response.status}: ${responseText.slice(0, 500)}`);
  console.log(`[r2] uploaded ${source} -> r2://${bucket}/${objectKey}`);
}

async function main() {
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const accessKeySecret = process.env.R2_SECRET_ACCESS_KEY;
  const accountId = process.env.R2_ACCOUNT_ID;
  const bucket = process.env.R2_BUCKET_NAME;
  const source = process.env.R2_SOURCE;
  if (!accessKeyId) fail('R2_ACCESS_KEY_ID is required');
  if (!accessKeySecret) fail('R2_SECRET_ACCESS_KEY is required');
  if (!accountId) fail('R2_ACCOUNT_ID is required');
  if (!bucket) fail('R2_BUCKET_NAME is required');
  if (!source) fail('R2_SOURCE is required');
  const objectKey = process.env.R2_OBJECT_KEY;
  const latestObjectKey = process.env.R2_LATEST_OBJECT_KEY;
  if (!objectKey || !latestObjectKey) fail('R2_OBJECT_KEY and R2_LATEST_OBJECT_KEY are required');
  await uploadR2Object({ accessKeyId, accessKeySecret, accountId, bucket, cacheControl: 'public, max-age=31536000, immutable', objectKey, source });
  await uploadR2Object({ accessKeyId, accessKeySecret, accountId, bucket, cacheControl: 'public, max-age=300, must-revalidate', objectKey: latestObjectKey, source });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
