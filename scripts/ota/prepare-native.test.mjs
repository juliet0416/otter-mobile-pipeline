import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { archivesFor, verifyArchive } from './prepare-native.mjs';
import { sha256 } from './runtime.mjs';
test('iOS prepares every archive the podspec can download; Android only its own', () => {
  assert.equal(archivesFor('ios').length, 6);
  assert.deepEqual(archivesFor('android'), ['android.zip', 'jniLibs.zip']);
  assert.throws(() => archivesFor('web'));
});
test('corrupt native archives are rejected before extraction', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ota-test-'));
  try {
    const file = path.join(dir, 'binary.zip');
    writeFileSync(file, 'original');
    assert.doesNotThrow(() => verifyArchive(file, sha256('original')));
    writeFileSync(file, 'corrupt');
    assert.throws(() => verifyArchive(file, sha256('original')), /SHA256/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
