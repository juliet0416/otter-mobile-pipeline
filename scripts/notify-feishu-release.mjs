#!/usr/bin/env node

import { createHmac } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const SUCCESS_RESULTS = new Set(['success', 'skipped']);
const PLATFORM_LABELS = {
  android: 'Android',
  ios: 'iOS',
};

// 源码 ref 超链基底（发版 tag 的 GitHub Release 页）
const SOURCE_REF_BASE_URL = 'https://github.com/OtterMind/ottermind/releases/tag/';
// aab 产物超链：Google Play Console 提交记录（固定）
const GOOGLE_PLAY_CONSOLE_URL = 'https://play.google.com/console/u/0/developers/7538199493925030729/app/4973906953075418289/publishing/submission-activity';
// ios 产物超链：App Store Connect TestFlight（固定）
const APP_STORE_CONNECT_URL = 'https://appstoreconnect.apple.com/teams/b10774f3-6988-4d42-acec-e250bcd60832/apps/6764060074/testflight/ios';
// APK 产物超链兜底规则基底（与 R2_PUBLIC_BASE_URL + R2_OBJECT_PREFIX 对齐）
const APK_DOWNLOAD_BASE_URL = 'https://cdn.ottermind.ai/mobile/appUpdate/';

function compact(values) {
  return values.filter((value) => value !== undefined && value !== null && value !== '');
}

function normalizeBoolean(value) {
  return String(value ?? '').toLowerCase() === 'true';
}

function normalizeArtifactSummary(summary) {
  return {
    artifactName: summary.artifactName ?? summary.artifact_name ?? '',
    artifactType: summary.artifactType ?? summary.artifact_type ?? '',
    buildNumber: summary.buildNumber ?? summary.build_number ?? '',
    buildResult: summary.buildResult ?? summary.build_result ?? '',
    r2Destination: summary.r2Destination ?? summary.r2_destination ?? summary.ossDestination ?? summary.oss_destination ?? '',
    r2PublicUrl: summary.r2PublicUrl ?? summary.r2_public_url ?? summary.ossPublicUrl ?? summary.oss_public_url ?? '',
    r2Upload: summary.r2Upload ?? summary.r2_upload ?? summary.ossUpload ?? summary.oss_upload,
    submitToStore: summary.submitToStore ?? summary.submit_to_store,
    target: summary.target ?? '',
  };
}

export function resolveOverallStatus(jobResults) {
  return jobResults.every((result) => SUCCESS_RESULTS.has(String(result ?? '').toLowerCase()))
    ? 'success'
    : 'failure';
}

function statusText(status) {
  return status === 'success' ? '成功' : '失败';
}

function statusTemplate(status) {
  return status === 'success' ? 'green' : 'red';
}

function buildField(label, value) {
  return {
    is_short: true,
    text: {
      tag: 'lark_md',
      content: `**${label}**\n${value}`,
    },
  };
}

function markdownLink(label, url) {
  return url ? `[${label}](${url})` : label;
}

function runNumberFromUrl(url) {
  const match = String(url ?? '').match(/\/actions\/runs\/([^/?#]+)/);
  return match?.[1] ?? '';
}

function resolveSourceRefUrl(ref) {
  return ref ? `${SOURCE_REF_BASE_URL}${ref}` : '';
}

// 产物超链：ios 固定 App Store Connect；apk 优先 R2 公网地址、兜底按规则拼；aab 固定 Google Play Console
function resolveArtifactUrl(input, artifacts) {
  const platform = String(input.platform ?? '').toLowerCase();
  if (platform === 'ios') {
    return APP_STORE_CONNECT_URL;
  }
  const artifactName = String(input.artifactName ?? '');
  if (/\.apk$/i.test(artifactName)) {
    if (input.r2PublicUrl) return input.r2PublicUrl;
    const apkArtifact = artifacts.find((artifact) => {
      const type = String(artifact.artifactType ?? '').toLowerCase();
      const name = String(artifact.artifactName ?? '');
      return type === 'apk' || /\.apk$/i.test(name);
    });
    if (apkArtifact?.r2PublicUrl) return apkArtifact.r2PublicUrl;
    if (input.version && input.buildNumber) {
      const name = input.target === 'production'
        ? `ottermind_Android_global_${input.version}-${input.buildNumber}.apk`
        : `ottermind_Android_${input.version}-${input.buildNumber}.apk`;
      return `${APK_DOWNLOAD_BASE_URL}${name}`;
    }
    return '';
  }
  // aab 及其余 android 产物统一指向 Google Play Console 提交记录
  return GOOGLE_PLAY_CONSOLE_URL;
}

function readArtifactSummaries(dir) {
  if (!dir || !existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => {
      const fullPath = path.join(dir, file);
      return normalizeArtifactSummary(JSON.parse(readFileSync(fullPath, 'utf8')));
    });
}

export function buildFeishuCardPayload(input) {
  const artifacts = (input.artifacts ?? []).map(normalizeArtifactSummary);
  const status = input.status ?? resolveOverallStatus(input.jobResults ?? []);
  const platform = PLATFORM_LABELS[input.platform] ?? input.platform ?? 'mobile';
  const title = `${platform} 打包${statusText(status)}`;
  const targets = [...new Set(compact(artifacts.map((artifact) => artifact.target)))];
  const buildNumbers = [...new Set(compact(artifacts.map((artifact) => artifact.buildNumber)))];
  const releaseParts = compact([
    input.ref,
    targets.length > 1 ? `targets=${targets.join(',')}` : input.target ? `target=${input.target}` : null,
    input.version ? `version=${input.version}` : null,
    buildNumbers.length > 1 ? `builds=${buildNumbers.join(',')}` : input.buildNumber ? `build=${input.buildNumber}` : null,
  ]);

  const fields = [
    buildField('平台', platform),
    buildField('发布目标', targets.length > 0 ? targets.join(', ') : input.target ?? '-'),
    buildField('源码 ref', input.ref ? markdownLink(input.ref, resolveSourceRefUrl(input.ref)) : '-'),
    buildField('版本', input.version ?? '-'),
    buildField('构建号', buildNumbers.length > 0 ? buildNumbers.join(', ') : input.buildNumber ?? '-'),
    buildField('提交商店', input.submitToStore ? '是' : '否'),
  ];

  if (input.artifactName) {
    const artifactUrl = resolveArtifactUrl(input, artifacts);
    const artifactValue = artifactUrl
      ? markdownLink(input.artifactName, artifactUrl)
      : input.artifactName;
    fields.push(buildField('产物', artifactValue));
  }
  if (input.runUrl) {
    const runNumber = input.runNumber || runNumberFromUrl(input.runUrl);
    fields.push(buildField('Actions', markdownLink(`#${runNumber || 'run'}`, input.runUrl)));
  }

  return {
    msg_type: 'interactive',
    card: {
      config: {
        wide_screen_mode: true,
      },
      header: {
        template: statusTemplate(status),
        title: {
          tag: 'plain_text',
          content: title,
        },
      },
      elements: [
        {
          tag: 'div',
          text: {
            tag: 'lark_md',
            content: releaseParts.length > 0 ? releaseParts.join(' · ') : 'Mobile release pipeline',
          },
        },
        {
          tag: 'hr',
        },
        {
          tag: 'div',
          fields,
        },
      ],
    },
  };
}

export function buildSignedBody(payload, options = {}) {
  if (!options.secret) return payload;

  const timestamp = String(options.timestamp ?? Math.floor(Date.now() / 1000));
  const sign = createHmac('sha256', `${timestamp}\n${options.secret}`)
    .update('')
    .digest('base64');

  return {
    timestamp,
    sign,
    ...payload,
  };
}

export function buildNotificationInputFromEnv(env = process.env) {
  const webhookUrl = env.FEISHU_RELEASE_WEBHOOK_URL;
  if (!webhookUrl) {
    return {
      skipped: true,
      reason: 'FEISHU_RELEASE_WEBHOOK_URL is not configured',
    };
  }

  const jobResults = compact([
    env.PREPARE_RESULT,
    env.BUILD_RESULT,
    env.SUBMIT_RESULT,
  ]);

  return {
    artifactName: env.RELEASE_ARTIFACT_NAME,
    artifacts: readArtifactSummaries(env.RELEASE_ARTIFACTS_JSON_DIR),
    buildNumber: env.RELEASE_BUILD_NUMBER,
    jobResults,
    r2Destination: env.RELEASE_R2_DESTINATION ?? env.RELEASE_OSS_DESTINATION,
    r2PublicUrl: env.RELEASE_R2_PUBLIC_URL ?? env.RELEASE_OSS_PUBLIC_URL,
    r2Upload: env.RELEASE_R2_UPLOAD === undefined
      ? (env.RELEASE_OSS_UPLOAD === undefined ? undefined : normalizeBoolean(env.RELEASE_OSS_UPLOAD))
      : normalizeBoolean(env.RELEASE_R2_UPLOAD),
    platform: env.RELEASE_PLATFORM,
    ref: env.RELEASE_REF,
    runNumber: env.GITHUB_RUN_NUMBER,
    runUrl: env.GITHUB_RUN_URL,
    secret: env.FEISHU_RELEASE_WEBHOOK_SECRET,
    submitToStore: normalizeBoolean(env.RELEASE_SUBMIT_TO_STORE),
    target: env.RELEASE_TARGET,
    version: env.RELEASE_VERSION,
    webhookUrl,
  };
}

export async function sendFeishuNotification({
  fetchImpl = fetch,
  payload,
  secret,
  webhookUrl,
  warn = console.warn,
}) {
  const body = buildSignedBody(payload, { secret });
  const response = await fetchImpl(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
  });

  const responseText = await response.text().catch(() => '');
  const responsePayload = parseJsonResponse(responseText);
  const feishuCode = responsePayload?.code ?? responsePayload?.StatusCode;
  const feishuOk = feishuCode === undefined || feishuCode === 0;
  const ok = response.ok && feishuOk;
  if (!ok) {
    warn(`[feishu] webhook returned ${response.status}: ${responseText}`);
  }

  return {
    feishuCode,
    ok,
    status: response.status,
    text: responseText,
  };
}

function parseJsonResponse(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function main() {
  const input = buildNotificationInputFromEnv();
  if (input.skipped) {
    console.log(`[feishu] skipped: ${input.reason}`);
    return;
  }

  const payload = buildFeishuCardPayload(input);
  await sendFeishuNotification({
    payload,
    secret: input.secret,
    webhookUrl: input.webhookUrl,
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.warn(`[feishu] notification failed: ${error instanceof Error ? error.message : String(error)}`);
  });
}
