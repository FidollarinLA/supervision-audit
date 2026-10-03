import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { audit_jsonl } from '../web/engine.js';
const fixture = name => readFileSync(new URL('../examples/transformers/' + name, import.meta.url), 'utf8');
const rows = () => fixture('batch.jsonl').trim().split('\n').map(JSON.parse);
const audit = values => JSON.parse(audit_jsonl(values.map(row => JSON.stringify(row)).join('\n'), '["text"]'));

test('real collator export retains padding and first-target semantics', () => {
  const samples = rows();
  assert.deepEqual(samples.map(row => row.labels), [
    [3, 5, 12, 6, 4, 11, 8, 10],
    [2, 11, 9, 7, -100, -100, -100, -100],
    [3, -100, -100, -100, -100, -100, -100, -100],
  ]);
  const result = audit(samples);
  assert.equal(result.ok, true);
  assert.equal(result.report.status, 'review');
  assert.equal(result.report.supervised_tokens, 13);
  assert.equal(result.report.token_count, 24);
  assert.equal(result.report.error_count, 0);
  assert.equal(result.report.unknown_count, 0);
  assert.deepEqual(result.report.findings.map(f => [f.code, f.sample_id, f.token_index]),
    samples.map(row => ['FIRST_TOKEN_NOT_PREDICTED', row.id, 0]));
  assert.deepEqual(result.document.samples.map(row => row.labels), samples.map(row => row.labels));
  const manifest = JSON.parse(fixture('manifest.json'));
  assert.equal(manifest.corpus_sha256, createHash('sha256').update(fixture('corpus.jsonl')).digest('hex'));
  assert.deepEqual(manifest.label_transformations, []);
});

test('padding label corruption after the collator is diagnosed at its exact source', () => {
  const samples = rows();
  samples[1].labels[4] = samples[1].input_ids[4];
  const result = audit(samples).report;
  assert.equal(result.status, 'fail');
  assert.deepEqual(result.findings.filter(f => f.severity === 'error').map(f => [f.code, f.sample_id, f.token_index]), [
    ['PACKING_CROSS_SOURCE_TARGET', 'text-short', 4],
    ['PADDING_SUPERVISED', 'text-short', 4],
  ]);
});

test('prematurely shifted collator labels cannot be mistaken for supported labels', () => {
  const samples = rows();
  samples[0].labels = [...samples[0].labels.slice(1), -100];
  const result = audit(samples).report;
  assert.equal(result.status, 'fail');
  assert.deepEqual(result.findings.filter(f => f.code === 'LABEL_TOKEN_MISMATCH').map(f => f.token_index), [0, 1, 2, 3, 4, 5, 6]);
});

test('stripping exporter provenance leaves unknown evidence, not an inferred pass', () => {
  const samples = rows();
  for (const row of samples) { delete row.spans; delete row.segments; }
  const result = audit(samples).report;
  assert.equal(result.status, 'review');
  assert.equal(result.unknown_count, 6);
  assert.equal(result.error_count, 0);
});
