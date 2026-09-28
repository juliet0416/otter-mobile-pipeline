import { test } from 'node:test';
import assert from 'node:assert/strict';
import { productionEnv, validateInputs, assertCompatible, summarizeSources } from './runtime.mjs';

test('canonical production configuration separates region but shares platform channel', () => {
  assert.equal(productionEnv('prod').OTTERMIND_OTA_TARGET, 'global');
  assert.equal(productionEnv('cn-prod').EXPO_PUBLIC_API_BASE_URL, 'https://api.ottermind.cn');
  assert.throws(() => productionEnv('dev'), /channel/);
});
test('input contract requires immutable source and an exact binary asset', () => {
  const good = { ref: 'a'.repeat(40), platform: 'android', channel: 'cn-prod', release: 'mobile-v1.4.7', artifact: 'mobile-1.4.7-cn.apk', message: '修复问题\r\n- 第二条', dryRun: 'true' };
  assert.equal(validateInputs(good).message, '修复问题\n- 第二条');
  for (const changes of [{ ref: 'main' }, { artifact: '../evil.apk' }, { artifact: '*.apk' }, { platform: 'ios' }, { dryRun: 'yes' }, { message: '' }]) {
    assert.throws(() => validateInputs({ ...good, ...changes }));
  }
});
const snapshot = { schema: 1, platform: 'ios', channel: 'prod', version: '1.4.7', runtimeVersion: 'a'.repeat(40), recipe: 'b'.repeat(64), toolchain: { node: '22.16.0', bun: '1.3.6', os: 'darwin', arch: 'arm64' }, fingerprintSources: [{ type: 'dir', filePath: 'native', hash: '1' }] };
test('compatible snapshots can have different JS commits', () => {
  assert.doesNotThrow(() => assertCompatible({ ...snapshot, sourceCommit: 'old' }, { ...snapshot, sourceCommit: 'new' }));
});
test('runtime/config/recipe/tool changes stop before publication', () => {
  for (const changes of [{ runtimeVersion: 'b'.repeat(40) }, { version: '1.4.8' }, { channel: 'cn-prod' }, { platform: 'android' }, { recipe: 'c'.repeat(64) }, { toolchain: { ...snapshot.toolchain, bun: '1.3.7' } }]) {
    assert.throws(() => assertCompatible(snapshot, { ...snapshot, ...changes }), /不匹配/);
  }
});
test('fingerprint records never store raw config contents', () => {
  assert.deepEqual(summarizeSources([{ type: 'contents', id: 'expoConfig', contents: 'SECRET', hash: '123', reasons: ['config'] }]), [{ type: 'contents', id: 'expoConfig', hash: '123' }]);
});
