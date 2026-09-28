import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

//#region 固定 Android 依赖的编译前状态
export function prepareAndroidManifest(sourceRoot) {
  const root = path.resolve(sourceRoot, 'node_modules/@react-native-masked-view/masked-view');
  const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (version !== '0.3.2') throw new Error(`masked-view 版本已变化（${version}），需重新审查其 Gradle Manifest 处理；当前仅验证 0.3.2`);
  const file = path.join(root, 'android/src/main/AndroidManifest.xml');
  const contents = readFileSync(file, 'utf8');
  const attribute = 'package="org.reactnative.maskedview"';
  const opening = contents.match(/<manifest\b[^>]*>/)?.[0];
  if (!opening || (/\bpackage\s*=/.test(opening) && !opening.includes(attribute))) {
    throw new Error('masked-view AndroidManifest 格式变化，停止准备以避免掩盖原生变更');
  }
  // 0.3.2 的 Gradle 在 AGP >= 7 时删除此属性并写回 node_modules。
  // 提前完成相同转换，保留包括双空格在内的其他字节，让母包与 OTA 指纹一致。
  const normalized = contents.replaceAll(attribute, '');
  if (normalized !== contents) writeFileSync(file, normalized);
  console.log('[OTA] Android masked-view Manifest 已固定为 Gradle 编译时状态');
}
//#endregion
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('Expected source checkout path');
  prepareAndroidManifest(process.argv[2]);
}
