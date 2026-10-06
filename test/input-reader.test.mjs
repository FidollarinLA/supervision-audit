import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { readAuditStream } from '../scripts/read-audit-input.mjs';
import { audit_json, audit_jsonl, compare_json, input_limit_utf16 } from '../web/engine.js';

test('bounded reader preserves split UTF-8 and matches existing replacement decoding', async () => {
  const bytes = Buffer.concat([Buffer.from('训练🌙\r\n'), Buffer.from([0xe4, 0xb8])]);
  const stream = Readable.from([...bytes].map(byte => Buffer.from([byte])), { objectMode: false, highWaterMark: 1 });
  assert.equal(await readAuditStream(stream), bytes.toString('utf8'));
  assert.equal(stream.destroyed, true);
  const text = '中'.repeat(400000); // More than 1 MiB in UTF-8, below the UTF-16 limit.
  assert.equal(await readAuditStream(Readable.from([Buffer.from(text)], { objectMode: false })), text);
});

test('bounded reader closes an oversized source early and delegates overflow to all core bridges', async () => {
  let reads = 0;
  const stream = new Readable({
    highWaterMark: 65536,
    read() { reads++; this.push(reads === 100 ? null : Buffer.alloc(65536, 32)); },
  });
  const text = await readAuditStream(stream);
  assert.equal(text.length, input_limit_utf16() + 1);
  assert.equal(stream.destroyed, true);
  assert.ok(reads < 100, 'reader must not drain the oversized source');
  for (const output of [audit_json(text), audit_jsonl(text, '["text"]'), compare_json(text, '{}'), compare_json('{}', text)]) {
    const result = JSON.parse(output);
    assert.equal(result.ok, false);
    assert.match(result.error, /limit|exceeds/);
    assert.equal(result.report, undefined);
    assert.equal(result.comparison, undefined);
  }
});

test('a Unicode code point crossing the cap cannot turn an oversized input into a pass', async () => {
  const prefix = ' '.repeat(input_limit_utf16());
  const stream = Readable.from([Buffer.from(prefix), Buffer.from('🌙')], { objectMode: false });
  const text = await readAuditStream(stream);
  assert.equal(text.length, input_limit_utf16() + 1);
  assert.match(JSON.parse(audit_json(text)).error, /exceeds/);
});

test('read errors are propagated, never returned as successfully read prefixes', async () => {
  const stream = Readable.from((async function* () {
    yield Buffer.from('{');
    throw new Error('synthetic read failure');
  })());
  await assert.rejects(readAuditStream(stream), /synthetic read failure/);
  assert.equal(stream.destroyed, true);
});
