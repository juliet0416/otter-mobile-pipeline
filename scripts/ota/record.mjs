import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { capture, assertCompatible, pipelineRoot, updateUrl } from './runtime.mjs';

//#region 真实安装包与构建记录绑定
export function readBinary(file) {
  return JSON.parse(execFileSync('python3', [path.join(pipelineRoot, 'scripts/ota/read-binary.py'), file], { encoding: 'utf8' }));
}
export function assertBinary(snapshot, binary) {
  for (const key of ['platform', 'channel', 'version', 'runtimeVersion']) {
    if (snapshot[key] !== binary[key]) throw new Error(`安装包 ${key} 与指纹记录不匹配：${binary[key]} / ${snapshot[key]}`);
  }
  if (binary.updateUrl !== updateUrl) throw new Error('安装包 OTA URL 不匹配');
  if (snapshot.artifact && (snapshot.artifact.sha256 !== binary.sha256 || snapshot.artifact.name !== binary.name)) throw new Error('安装包 SHA256 / 文件名与构建记录不匹配');
}
export async function record(app, platform, channel, beforeFile, binaryFile) {
  const before = JSON.parse(readFileSync(beforeFile));
  const after = await capture(app, platform, channel);
  writeFileSync(path.join(path.dirname(beforeFile), 'ota-after.json'), `${JSON.stringify(after, null, 2)}\n`);
  assertCompatible(before, after);
  const binary = readBinary(binaryFile);
  assertBinary(after, binary);
  const result = { ...after, artifact: binary, runUrl: process.env.GITHUB_SERVER_URL ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null };
  writeFileSync(`${binaryFile}.ota.json`, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`[OTA] 已验证真实安装包 runtime=${binary.runtimeVersion}，记录=${binaryFile}.ota.json`);
}
//#endregion
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, app, platform, channel, beforeFile, binaryFile] = process.argv.slice(2);
  if (mode === 'snapshot') {
    mkdirSync(path.dirname(beforeFile), { recursive: true });
    writeFileSync(beforeFile, `${JSON.stringify(await capture(app, platform, channel), null, 2)}\n`);
  } else if (mode === 'record') {
    await record(app, platform, channel, beforeFile, binaryFile);
  } else throw new Error('Expected snapshot or record');
}
