import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256, toolchain } from './runtime.mjs';

//#region 原生预编译依赖：只从固定校验值的压缩包准备，不恢复展开后的目录缓存
export function archivesFor(platform) {
  if (platform === 'ios') return Object.keys(toolchain.archives);
  if (platform === 'android') return ['android.zip', 'jniLibs.zip'];
  throw new Error('Invalid platform');
}
export function verifyArchive(file, expected) {
  if (sha256(readFileSync(file)) !== expected) throw new Error(`预编译文件 SHA256 不匹配：${path.basename(file)}`);
}
export function prepareNative(sourceRoot, platform) {
  const archives = archivesFor(platform);
  const root = path.resolve(sourceRoot, 'node_modules/react-native-audio-api');
  if (JSON.parse(readFileSync(path.join(root, 'package.json'))).version !== toolchain.audioApi) {
    throw new Error('音频库版本变化：需要更新预编译文件清单并重建母包');
  }
  const external = path.join(root, 'common/cpp/audioapi/external');
  // 不覆盖已有文件，防止在日常开发目录运行时掩盖污染。
  for (const archive of Object.keys(toolchain.archives)) {
    const dest = archive === 'jniLibs.zip' ? path.join(root, 'android/src/main') : external;
    if (existsSync(path.join(dest, archive.replace('.zip', '')))) throw new Error('原生预编译目录已存在；必须从全新 checkout 安装依赖');
  }
  const temp = mkdtempSync(path.join(tmpdir(), 'ota-native-'));
  try {
    for (const name of archives) {
      const zip = path.join(temp, name);
      execFileSync('curl', ['--fail', '--location', '--silent', '--show-error', '--retry', '4', '--retry-all-errors', '--connect-timeout', '30', '--max-time', '300',
        `https://github.com/software-mansion-labs/rn-audio-libs/releases/download/${toolchain.audioTag}/${name}`, '-o', zip], { stdio: 'inherit' });
      verifyArchive(zip, toolchain.archives[name]);
      const dest = name === 'jniLibs.zip' ? path.join(root, 'android/src/main') : external;
      execFileSync('unzip', ['-q', '-o', zip, '-d', dest]);
      rmSync(path.join(dest, '__MACOSX'), { recursive: true, force: true });
      if (!existsSync(path.join(dest, name.replace('.zip', '')))) throw new Error(`压缩包缺少预期目录：${name}`);
    }
    if (platform === 'ios') {
      // 上游 iOS 准备脚本会遍历所有平台，提前准备全部文件避免 Pod 缓存影响结果。
      // 所有目录已通过固定 SHA 校验，此调用只恢复 framework symlink，不再下载。
      execFileSync('bash', ['scripts/download-prebuilt-binaries.sh', 'ios'], { cwd: root, stdio: 'inherit' });
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
  console.log(`[OTA] ${platform} 原生预编译文件已校验并准备完成`);
}
//#endregion
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  prepareNative(process.argv[2], process.argv[3]);
}
