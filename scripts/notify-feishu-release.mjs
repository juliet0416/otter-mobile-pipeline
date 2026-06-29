#!/usr/bin/env node

import { createHmac } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const SUCCESS_RESULTS = new Set(['success', 'skipped']);
const PLATFORM_LABELS = {
  android: 'Android',
  ios: 'iOS',
};

function compact(values) {
  return values.filter((value) => value !== undefined && value !== null && value !== '');
}

function normalizeBoolean(value) {
  return String(value ?? '').toLowerCase() === 'true';
}

function truncate(value, maxLength = 120) {
  const text = String(value ?? '');
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}...`;
}

function normalizeArtifactSummary(summary) {
  return {
    artifactName: summary.artifactName ?? summary.artifact_name ?? '',
    artifactType: summary.artifactType ?? summary.artifact_type ?? '',
    buildNumber: summary.buildNumber ?? summary.build_number ?? '',
    buildResult: summary.buildResult ?? summary.build_result ?? '',
    ossDestination: summary.ossDestination ?? summary.oss_destination ?? '',
    ossPublicUrl: summary.ossPublicUrl ?? summary.oss_public_url ?? '',
    ossUpload: summary.ossUpload ?? summary.oss_upload,
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

function buildFullWidthBlock(label, value) {
  return {
    tag: 'div',
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

function basename(value) {
  return String(value ?? '').split('/').filter(Boolean).at(-1) ?? String(value ?? '');
}

function statusIcon(status) {
  const value = String(status ?? '').toLowerCase();
  if (value === 'success' || value === 'skipped') return '成功';
  if (value === 'failure' || value === 'cancelled' || value === 'timed_out') return '失败';
  return value || '-';
}

function normalizeOssUpload(value) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  return normalizeBoolean(value);
}

function formatArtifactLine(artifact) {
  const parts = compact([
    artifact.target,
    artifact.artifactType?.toUpperCase(),
    artifact.buildNumber ? `build=${artifact.buildNumber}` : null,
    artifact.buildResult ? statusIcon(artifact.buildResult) : null,
  ]);
  return `${parts.join(' · ')}\n${artifact.artifactName || '-'}`;
}

function formatOssLine(artifact) {
  const upload = normalizeOssUpload(artifact.ossUpload);
  if (upload === undefined && !artifact.ossDestination) return null;
  const status = upload ? '是' : '否';
  if (!artifact.ossDestination) return `${artifact.target || '-'} · ${status}`;
  const label = basename(artifact.ossDestination) || artifact.ossDestination;
  return `${artifact.target || '-'} · ${status} · ${markdownLink(label, artifact.ossPublicUrl)}`;
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
    buildField('源码 ref', input.ref ?? '-'),
    buildField('版本', input.version ?? '-'),
    buildField('构建号', buildNumbers.length > 0 ? buildNumbers.join(', ') : input.buildNumber ?? '-'),
    buildField('提交商店', input.submitToStore ? '是' : '否'),
  ];

  if (input.artifactName) {
    fields.push(buildField('产物', truncate(input.artifactName)));
  }
  if (input.ossUpload !== undefined) {
    fields.push(buildField('OSS 上传', input.ossUpload ? '是' : '否'));
  }
  if (input.ossDestination) {
    const ossLabel = basename(input.ossDestination);
    fields.push(buildField('OSS 地址', truncate(markdownLink(ossLabel || input.ossDestination, input.ossPublicUrl))));
  }
  if (input.runUrl) {
    const runNumber = input.runNumber || runNumberFromUrl(input.runUrl);
    fields.push(buildField('Actions', markdownLink(`#${runNumber || 'run'}`, input.runUrl)));
  }

  const artifactLines = artifacts.map(formatArtifactLine);
  const ossLines = compact(artifacts.map(formatOssLine));
  const detailBlocks = [];
  if (artifactLines.length > 0) {
    detailBlocks.push(buildFullWidthBlock('产物列表', artifactLines.join('\n\n')));
  }
  if (ossLines.length > 0) {
    detailBlocks.push(buildFullWidthBlock('OSS 上传', ossLines.join('\n')));
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
        ...detailBlocks,
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
    ossDestination: env.RELEASE_OSS_DESTINATION,
    ossPublicUrl: env.RELEASE_OSS_PUBLIC_URL,
    ossUpload: env.RELEASE_OSS_UPLOAD === undefined ? undefined : normalizeBoolean(env.RELEASE_OSS_UPLOAD),
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
