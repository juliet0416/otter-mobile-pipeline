import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertBinary } from './record.mjs';
import { updateUrl } from './runtime.mjs';
const baseline = { platform: 'ios', channel: 'prod', version: '1.4.7', runtimeVersion: 'a'.repeat(40), artifact: { name: 'app.ipa', sha256: '1'.repeat(64) } };
const binary = { ...baseline, ...baseline.artifact, updateUrl };
test('verified native runtime and artifact bytes match', () => assert.doesNotThrow(() => assertBinary(baseline, binary)));
test('stale sidecar, different binary, region or disabled project cannot pass', () => {
  for (const changes of [{ runtimeVersion: 'b'.repeat(40) }, { sha256: '2'.repeat(64) }, { name: 'new.ipa' }, { channel: 'cn-prod' }, { updateUrl: 'https://evil.test' }]) {
    assert.throws(() => assertBinary(baseline, { ...binary, ...changes }), /不匹配/);
  }
});
