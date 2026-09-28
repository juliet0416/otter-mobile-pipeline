import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

//#region 共用环境与发布输入
export const pipelineRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const toolchain = JSON.parse(readFileSync(new URL('./toolchain.json', import.meta.url)));
export const updateUrl = 'https://u.expo.dev/d6f72c0c-f638-4b0b-8524-53df9b6a8838';
export function productionEnv(channel) {
  if (!['prod', 'cn-prod'].includes(channel)) throw new Error('Invalid production channel');
  const cn = channel === 'cn-prod';
  return {
    EXPO_NO_DOTENV: '1', NODE_ENV: 'production', CI: '1',
    EXPO_PUBLIC_APP_CHANNEL: 'production', EXPO_PUBLIC_RELEASE_ENV: 'production',
    EXPO_PUBLIC_REGION: cn ? 'cn' : 'global', EXPO_PUBLIC_APP_TITLE: 'Ottermind',
    EXPO_PUBLIC_APP_ID: 'ai.ottermind.mobile',
    EXPO_PUBLIC_API_BASE_URL: cn ? 'https://api.ottermind.cn' : 'https://api.ottermind.ai',
    EXPO_PUBLIC_WWW_URL: 'https://ottermind.ai', EXPO_PUBLIC_STUDIO_URL: 'https://ottermind.ai/studio',
    OTTERMIND_WORKLETS_BUNDLE_MODE: '0', OTTERMIND_OTA_ENABLED: '1',
    OTTERMIND_OTA_TARGET: cn ? 'cn-apk' : 'global', OTTERMIND_OTA_UPDATE_URL: updateUrl,
    // 使用显式配置，避免 EAS profile / 本机交互预设覆盖母包环境。
    OTTERMIND_OTA_ENV: '', EAS_BUILD_PROFILE: '',
  };
}
export function validateInputs(input) {
  if (!/^[a-f0-9]{40}$/.test(input.ref ?? '')) throw new Error('补丁 ref 必须是完整的 40 位 Git commit SHA');
  if (!['ios', 'android'].includes(input.platform)) throw new Error('Invalid platform');
  productionEnv(input.channel);
  if (input.channel === 'cn-prod' && input.platform !== 'android') throw new Error('cn-prod 只支持 Android');
  if (!/^mobile-v\d+\.\d+\.\d+$/.test(input.release ?? '')) throw new Error('Invalid release tag');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.(apk|aab|ipa)$/.test(input.artifact ?? '')) throw new Error('必须指定完整安装包文件名，不支持通配符或路径');
  if ((input.platform === 'ios') !== input.artifact.endsWith('.ipa')) throw new Error('安装包与平台不匹配');
  const message = (input.message ?? '').replace(/\r\n?/g, '\n').trim();
  if (!message || message.length > 4000) throw new Error('更新说明须为 1–4000 个字符');
  if (!['true', 'false'].includes(String(input.dryRun))) throw new Error('dry_run must be true or false');
  return { ...input, message, dryRun: String(input.dryRun) === 'true' };
}
//#endregion

//#region 指纹记录与兼容性检查
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export function recipeHash() {
  return sha256(['scripts/ota/toolchain.json', 'scripts/ota/prepare-native.mjs', 'scripts/ota/runtime.mjs', '.github/actions/prepare-mobile/action.yml']
    .map(file => `${file}\0${readFileSync(path.join(pipelineRoot, file), 'utf8')}`).join('\0'));
}
export function summarizeSources(sources) {
  return sources.map(({ type, id, filePath, hash }) => ({ type, ...(id ? { id } : {}), ...(filePath ? { filePath } : {}), hash }));
}
export function sourceDiff(left, right) {
  const key = s => `${s.type}:${s.id ?? s.filePath}`;
  const a = new Map((left ?? []).map(s => [key(s), s.hash]));
  const b = new Map((right ?? []).map(s => [key(s), s.hash]));
  return [...new Set([...a.keys(), ...b.keys()])].filter(k => a.get(k) !== b.get(k));
}
export function assertCompatible(baseline, candidate) {
  const fields = ['schema', 'platform', 'channel', 'version', 'recipe', 'runtimeVersion'];
  const mismatches = fields.filter(k => baseline[k] !== candidate[k]);
  for (const key of ['node', 'bun', 'os', 'arch']) {
    if (baseline.toolchain?.[key] !== candidate.toolchain?.[key]) mismatches.push(`toolchain.${key}`);
  }
  if (mismatches.length) {
    throw new Error(`OTA 不匹配：${mismatches.join(', ')}；母包 runtime=${baseline.runtimeVersion}，候选=${candidate.runtimeVersion}\n指纹差异：${sourceDiff(baseline.fingerprintSources, candidate.fingerprintSources).join(', ') || '请检查配置或准备流程版本'}\n已停止。不要强写 runtime；原生能力变化需要新安装包。`);
  }
}
export async function capture(appRoot, platform, channel) {
  appRoot = realpathSync(appRoot);
  const previousCwd = process.cwd();
  // expo-updates 的 VCS 检测使用进程 cwd；必须进入 App，否则嵌套 checkout 被误判为 bare。
  process.chdir(appRoot);
  try {
    if (!['ios', 'android'].includes(platform)) throw new Error('Invalid platform');
    Object.assign(process.env, productionEnv(channel));
    const require = createRequire(path.join(appRoot, 'package.json'));
    const { getConfig } = require('expo/config');
    const { exp } = getConfig(appRoot, { isPublicConfig: true });
    if (exp.runtimeVersion?.policy !== 'fingerprint' || !exp.updates?.enabled || exp.updates.url !== updateUrl || exp.updates.requestHeaders?.['expo-channel-name'] !== channel) {
      throw new Error('App 未启用预期的 fingerprint / OTA URL / channel');
    }
    const updatesRoot = path.dirname(require.resolve('expo-updates/package.json'));
    const { resolveRuntimeVersionAsync } = require(path.join(updatesRoot, 'utils/build/resolveRuntimeVersionAsync.js'));
    const data = await resolveRuntimeVersionAsync(appRoot, platform, {}, {});
    if (data.workflow !== 'managed' || !/^[a-f0-9]{40}$/.test(data.runtimeVersion ?? '') || !data.fingerprintSources?.length) {
      throw new Error('只支持当前 managed fingerprint 流程，拒绝缺少完整指纹的构建');
    }
    const sourceRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: appRoot, encoding: 'utf8' }).trim();
    return {
      schema: 1, platform, channel, version: exp.version, runtimeVersion: data.runtimeVersion,
      sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot, encoding: 'utf8' }).trim(),
      pipelineCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: pipelineRoot, encoding: 'utf8' }).trim(),
      recipe: recipeHash(), lockSha256: sha256(readFileSync(path.join(sourceRoot, 'bun.lock'))),
      toolchain: { node: process.versions.node, bun: execFileSync('bun', ['--version'], { encoding: 'utf8' }).trim(), os: process.platform, arch: process.arch },
      fingerprintSources: summarizeSources(data.fingerprintSources),
    };
  } finally { process.chdir(previousCwd); }
}
//#endregion
