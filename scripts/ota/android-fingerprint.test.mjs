import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync, copyFileSync, renameSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { prepareAndroidFingerprint } from './prepare-android.mjs';

const pattern = '**/expo-updates-gradle-plugin/.kotlin/**/*';
test('preserves existing ignore rules and appends only the Kotlin cache rule once', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'ota-ignore-'));
  const app = path.join(root, 'apps/mobile');
  mkdirSync(app, { recursive: true });
  const file = path.join(app, '.fingerprintignore');
  try {
    writeFileSync(file, '# existing\ncustom/path');
    prepareAndroidFingerprint(root);
    const first = readFileSync(file, 'utf8');
    assert.equal(first, `# existing\ncustom/path\n${pattern}\n`);
    prepareAndroidFingerprint(root);
    assert.equal(readFileSync(file, 'utf8'), first);
    rmSync(file);
    prepareAndroidFingerprint(root);
    assert.equal(readFileSync(file, 'utf8'), `${pattern}\n`);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// 指定真实 App checkout 后运行，使用安装包同版本的 Expo 算法和插件源码。
test('real Expo fingerprint stays stable during Kotlin sessions but detects native code changes', {
  skip: !process.env.OTA_TEST_SOURCE_ROOT && 'Set OTA_TEST_SOURCE_ROOT to a mobile source checkout for the real Expo regression',
}, async () => {
  const source = path.resolve(process.env.OTA_TEST_SOURCE_ROOT);
  const require = createRequire(path.join(source, 'package.json'));
  const fingerprint = path.dirname(require.resolve('@expo/fingerprint/package.json'));
  const { normalizeOptionsAsync } = require(path.join(fingerprint, 'build/Options.js'));
  const { createFingerprintFromSourcesAsync } = require(path.join(fingerprint, 'build/hash/Hash.js'));
  const root = mkdtempSync(path.join(tmpdir(), 'ota-kotlin-regression-'));
  const app = path.join(root, 'apps/mobile');
  const relative = '../../node_modules/expo-updates/expo-updates-gradle-plugin';
  const plugin = path.resolve(app, relative);
  const original = path.join(path.dirname(require.resolve('expo-updates/package.json')), 'expo-updates-gradle-plugin');
  mkdirSync(app, { recursive: true });
  mkdirSync(plugin, { recursive: true });
  writeFileSync(path.join(app, 'package.json'), '{"name":"fingerprint-regression","version":"1.0.0"}');
  cpSync(path.join(original, 'src'), path.join(plugin, 'src'), { recursive: true });
  copyFileSync(path.join(original, 'build.gradle.kts'), path.join(plugin, 'build.gradle.kts'));
  const hash = async () => {
    const options = await normalizeOptionsAsync(app, { platforms: ['android'], silent: true });
    return (await createFingerprintFromSourcesAsync([{ type: 'dir', filePath: relative, reasons: ['expoAutolinkingAndroid'] }], app, options)).sources[0].hash;
  };
  try {
    const before = await hash();
    const sessions = path.join(plugin, '.kotlin/sessions');
    mkdirSync(sessions, { recursive: true });
    writeFileSync(path.join(sessions, 'compiler-123.salive'), '');
    assert.notEqual(await hash(), before, 'must reproduce the original build-time drift');
    prepareAndroidFingerprint(root);
    assert.equal(await hash(), before, 'active session must not change the native fingerprint');
    renameSync(path.join(sessions, 'compiler-123.salive'), path.join(sessions, 'compiler-456.salive'));
    assert.equal(await hash(), before, 'random per-job session filename must not affect the result');
    rmSync(sessions, { recursive: true });
    assert.equal(await hash(), before, 'post-build cleanup must leave the same fingerprint');
    appendFileSync(path.join(plugin, 'src/main/kotlin/expo/modules/updates/ExpoUpdatesPlugin.kt'), '\n// changed native code\n');
    assert.notEqual(await hash(), before, 'real native source changes must still be detected');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
