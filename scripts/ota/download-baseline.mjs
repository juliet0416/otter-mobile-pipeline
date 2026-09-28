import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pipelineRoot } from './runtime.mjs';
import { assertBinary, readBinary } from './record.mjs';
const input = JSON.parse(readFileSync(path.join(pipelineRoot, '.private/ota-input.json')));
const destination = path.join(pipelineRoot, '.private/baseline');
mkdirSync(destination, { recursive: true });
if (!process.env.SOURCE_REPO) throw new Error('SOURCE_REPO required');
execFileSync('gh', ['release', 'download', input.release, '-R', process.env.SOURCE_REPO,
  '--pattern', input.artifact, '--pattern', `${input.artifact}.ota.json`, '--dir', destination], { stdio: 'inherit' });
const baseline = JSON.parse(readFileSync(path.join(destination, `${input.artifact}.ota.json`)));
if (baseline.schema !== 1 || !baseline.artifact) throw new Error('安装包缺少支持的 OTA 构建记录，需要用新流水线重建母包');
if (baseline.version !== input.release.slice('mobile-v'.length) || baseline.platform !== input.platform || baseline.channel !== input.channel) throw new Error('所选 Release / 平台 / 渠道与安装包不匹配');
assertBinary(baseline, readBinary(path.join(destination, input.artifact)));
console.log(`[OTA] 目标安装包已校验：${input.artifact} | runtime=${baseline.runtimeVersion}`);
