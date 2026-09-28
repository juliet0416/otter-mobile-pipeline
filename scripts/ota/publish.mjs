import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipelineRoot, productionEnv, capture, assertCompatible, toolchain } from './runtime.mjs';

//#region 发布阶段：校验、导出、再次校验，再上传同一份产物
export async function publishChecked({ input, baseline, snapshot, exportBundle, publishBundle }) {
  const before = await snapshot();
  assertCompatible(baseline, before);
  await exportBundle();
  const after = await snapshot();
  assertCompatible(baseline, after);
  if (!input.dryRun) await publishBundle();
  return after;
}
export async function main() {
  const input = JSON.parse(readFileSync(path.join(pipelineRoot, '.private/ota-input.json')));
  const baseline = JSON.parse(readFileSync(path.join(pipelineRoot, '.private/baseline', `${input.artifact}.ota.json`)));
  const app = path.join(pipelineRoot, 'source/apps/mobile');
  const output = path.join(pipelineRoot, '.private/ota-export');
  const env = productionEnv(input.channel);
  // env:exec 已注入 EAS production 变量。显式冲突必须报错，不能悄悄发布另一套配置。
  for (const [key, expected] of Object.entries(env)) {
    if (process.env[key] !== undefined && process.env[key] !== expected) throw new Error(`EAS production 环境变量 ${key} 与 ${input.channel} 不一致，请移除冲突配置`);
  }
  if (process.env.OTTERMIND_OTA_RELEASE_NOTES) throw new Error('请移除 EAS 环境中的 OTTERMIND_OTA_RELEASE_NOTES，更新说明由本次发布输入提供');
  Object.assign(process.env, env, { OTTERMIND_OTA_RELEASE_NOTES: input.message, EXPO_NO_GIT_STATUS: '1' });
  if (execFileSync('git', ['rev-parse', 'HEAD'], { cwd: app, encoding: 'utf8' }).trim() !== input.ref) throw new Error('实际检出提交与输入不符');
  if (process.versions.node !== toolchain.node || execFileSync('bun', ['--version'], { encoding: 'utf8' }).trim() !== toolchain.bun) throw new Error('工具链版本不符');
  const require = createRequire(path.join(app, 'package.json'));
  const expo = require.resolve('expo/bin/cli');
  // 与安装包一样执行配置插件，避免 prebuild 修改依赖后才产生不同指纹。
  execFileSync(process.execPath, [expo, 'prebuild', '--platform', input.platform, '--clean', '--no-install'], { cwd: app, stdio: 'inherit' });
  const current = await publishChecked({
    input, baseline,
    snapshot: async () => {
      const snapshot = await capture(app, input.platform, input.channel);
      writeFileSync(path.join(pipelineRoot, '.private/ota-candidate.json'), `${JSON.stringify(snapshot, null, 2)}\n`);
      return snapshot;
    },
    exportBundle: async () => execFileSync(process.execPath, [expo, 'export', '--platform', input.platform, '--output-dir', output, '--dump-assetmap', '--clear'], { cwd: app, stdio: 'inherit' }),
    publishBundle: async () => {
      if (!existsSync(path.join(output, 'metadata.json'))) throw new Error('缺少 Expo 导出 metadata.json');
      // 全文通过 extra.otaReleaseNotes 反显，Dashboard message 使用首行。
      const result = execFileSync('eas', ['update', '--channel', input.channel, '--platform', input.platform,
        '--environment', 'production', '--message', input.message.split('\n')[0].slice(0, 200),
        '--input-dir', output, '--skip-bundler', '--non-interactive', '--json'], {
        cwd: app, stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 10 * 1024 * 1024,
      }).toString();
      writeFileSync(path.join(pipelineRoot, '.private/ota-publish-result.json'), result);
      const updates = JSON.parse(result);
      if (!Array.isArray(updates) || !updates.length || updates.some(update => update.runtimeVersion !== baseline.runtimeVersion || update.platform !== input.platform)) {
        throw new Error('Expo 已返回发布结果，但 runtime / 平台与目标不符。请检查 ota-publish-result.json 和 Expo Dashboard，勿直接重试。');
      }
      console.log(`[OTA] Expo update groups: ${[...new Set(updates.map(update => update.group))].join(', ')}`);
    },
  });
  const summary = `### OTA ${input.dryRun ? '验证通过（未发布）' : '已发布'}\n\n- 渠道 / 平台：${input.channel} / ${input.platform}\n- 安装包：${input.artifact}\n- 源码：${input.ref}\n- Runtime：${current.runtimeVersion}\n`;
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  console.log(summary);
}
//#endregion
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
