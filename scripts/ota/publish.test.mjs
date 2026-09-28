import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publishChecked } from './publish.mjs';
const baseline = { schema: 1, platform: 'android', channel: 'prod', version: '1.4.7', recipe: 'same', runtimeVersion: 'same', toolchain: {} };
test('mismatch before export never exports or uploads', async () => {
  const calls = [];
  await assert.rejects(publishChecked({ input: { dryRun: false }, baseline, snapshot: async () => ({ ...baseline, runtimeVersion: 'different' }), exportBundle: async () => calls.push('export'), publishBundle: async () => calls.push('publish') }), /不匹配/);
  assert.deepEqual(calls, []);
});
test('native files changed during Metro export stop upload', async () => {
  let snapshots = 0;
  const calls = [];
  await assert.rejects(publishChecked({ input: { dryRun: false }, baseline, snapshot: async () => ++snapshots === 1 ? baseline : { ...baseline, runtimeVersion: 'changed' }, exportBundle: async () => calls.push('export'), publishBundle: async () => calls.push('publish') }), /不匹配/);
  assert.deepEqual(calls, ['export']);
});
for (const dryRun of [true, false]) test(`checked export has publication=${!dryRun}`, async () => {
  const calls = [];
  await publishChecked({ input: { dryRun }, baseline, snapshot: async () => { calls.push('check'); return baseline; }, exportBundle: async () => calls.push('export'), publishBundle: async () => calls.push('publish') });
  assert.deepEqual(calls, dryRun ? ['check', 'export', 'check'] : ['check', 'export', 'check', 'publish']);
});
