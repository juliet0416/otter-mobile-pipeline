#!/usr/bin/env node

import { createHmac } from 'node:crypto';

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

function basename(value) {
  return String(value ?? '').split('/').filter(Boolean).at(-1) ?? String(value ?? '');
}

export function buildFeishuCardPayload(input) {
  const status = input.status ?? resolveOverallStatus(input.jobResults ?? []);
  const platform = PLATFORM_LABELS[input.platform] ?? input.platform ?? 'mobile';
  const title = `${platform} 打包${statusText(status)}`;
  const releaseParts = compact([
    input.ref,
    input.target ? `target=${input.target}` : null,
    input.version ? `version=${input.version}` : null,
    input.buildNumber ? `build=${input.buildNumber}` : null,
  ]);

  const fields = [
    buildField('平台', platform),
    buildField('发布目标', input.target ?? '-'),
    buildField('源码 ref', input.ref ?? '-'),
    buildField('版本', input.version ?? '-'),
    buildField('构建号', input.buildNumber ?? '-'),
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
    const runNumber = runNumberFromUrl(input.runUrl);
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
    buildNumber: env.RELEASE_BUILD_NUMBER,
    jobResults,
    ossDestination: env.RELEASE_OSS_DESTINATION,
    ossPublicUrl: env.RELEASE_OSS_PUBLIC_URL,
    ossUpload: env.RELEASE_OSS_UPLOAD === undefined ? undefined : normalizeBoolean(env.RELEASE_OSS_UPLOAD),
    platform: env.RELEASE_PLATFORM,
    ref: env.RELEASE_REF,
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
