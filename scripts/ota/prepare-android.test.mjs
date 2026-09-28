import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { prepareAndroidManifest } from './prepare-android.mjs';

const original = '<manifest package="org.reactnative.maskedview" xmlns:android="http://schemas.android.com/apk/res/android">\n</manifest>\n';
function fixture(fn) {
  const root = mkdtempSync(path.join(tmpdir(), 'ota-masked-view-'));
  const library = path.join(root, 'node_modules/@react-native-masked-view/masked-view');
  const manifest = path.join(library, 'android/src/main/AndroidManifest.xml');
  mkdirSync(path.dirname(manifest), { recursive: true });
  writeFileSync(path.join(library, 'package.json'), JSON.stringify({ version: '0.3.2' }));
  writeFileSync(manifest, original);
  try { fn({ root, library, manifest }); } finally { rmSync(root, { recursive: true, force: true }); }
}
test('prepares exactly the bytes Gradle writes and remains stable on subsequent builds', () => fixture(({ root, manifest }) => {
  // 复现 0.3.2 的 AGP >= 7 分支；其空格 replaceAll 未赋值，不会改变文件。
  const gradleResult = original.replaceAll('package="org.reactnative.maskedview"', '');
  prepareAndroidManifest(root);
  assert.equal(readFileSync(manifest, 'utf8'), gradleResult);
  assert.equal(gradleResult.replaceAll('package="org.reactnative.maskedview"', ''), gradleResult);
  prepareAndroidManifest(root);
  assert.equal(readFileSync(manifest, 'utf8'), gradleResult);
}));
test('does not silently normalize a changed dependency version or unexpected manifest', () => fixture(({ root, library, manifest }) => {
  writeFileSync(path.join(library, 'package.json'), '{"version":"0.4.0"}');
  assert.throws(() => prepareAndroidManifest(root), /0.3.2/);
  assert.equal(readFileSync(manifest, 'utf8'), original);
  writeFileSync(path.join(library, 'package.json'), '{"version":"0.3.2"}');
  writeFileSync(manifest, original.replace('org.reactnative.maskedview', 'unexpected.package'));
  assert.throws(() => prepareAndroidManifest(root), /Manifest/);
}));
test('binary and OTA workflows normalize before any runtime capture or export; iOS is excluded', () => {
  const build = readFileSync(new URL('../../.github/workflows/mobile-android-release.yml', import.meta.url), 'utf8');
  const ota = readFileSync(new URL('../../.github/workflows/mobile-ota-update.yml', import.meta.url), 'utf8');
  const ios = readFileSync(new URL('../../.github/workflows/mobile-ios-release.yml', import.meta.url), 'utf8');
  const call = 'node scripts/ota/prepare-android.mjs source';
  assert.ok(build.indexOf(call) > build.indexOf('uses: ./.github/actions/prepare-mobile'));
  assert.ok(build.indexOf(call) < build.indexOf('Capture OTA runtime before compilation'));
  assert.ok(ota.indexOf(call) > ota.indexOf('uses: ./.github/actions/prepare-mobile'));
  assert.ok(ota.indexOf(call) < ota.indexOf('Load canonical production configuration'));
  assert.match(ota, /name: Normalize Android dependency manifest\n\s+if: inputs.platform == 'android'\n\s+run: node scripts\/ota\/prepare-android.mjs source/);
  assert.ok(!ios.includes(call));
});
