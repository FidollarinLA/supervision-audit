import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { audit_jsonl, compare_json } from '../web/engine.js';
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
  assert.equal(result.report.prediction_targets, 10);
  assert.deepEqual(result.report.samples.map(s => s.prediction_targets), [7, 3, 0]);
  assert.equal(result.report.token_count, 24);
  assert.equal(result.report.error_count, 0);
  assert.equal(result.report.unknown_count, 0);
  assert.deepEqual(result.report.findings.map(f => [f.code, f.sample_id, f.token_index]),
    [...samples.map(row => ['FIRST_TOKEN_NOT_PREDICTED', row.id, 0]), ['NO_PREDICTION_TARGETS', 'text-single', undefined]]);
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

for (const side of ['left', 'right']) {
  test(`real ${side} truncation preserves rebased evidence and reports supervision reduction`, () => {
    const samples = fixture(`truncate-${side}/batch.jsonl`).trim().split('\n').map(JSON.parse);
    const result = audit(samples);
    assert.equal(result.report.status, 'review');
    assert.equal(result.report.error_count, 0);
    assert.equal(result.report.unknown_count, 0);
    assert.equal(result.report.supervised_tokens, 9);
    assert.equal(result.report.prediction_targets, 6);
    assert.deepEqual(result.report.samples.map(s => s.prediction_targets), [3, 3, 0]);
    assert.deepEqual(result.report.findings.filter(f => f.code === 'SUPERVISION_REDUCED').map(f => [f.sample_id, f.message]),
      [['text-long', 'Supervised count decreased from 8 to 4; inspect truncation or preprocessing']]);
    assert.equal(result.report.warning_count, 5);
    assert.deepEqual(result.document.samples.map(s => s.labels), samples.map(s => s.labels));
    const manifest = JSON.parse(fixture(`truncate-${side}/manifest.json`));
    const [start, end] = manifest.truncation.source_ranges[0].retained_token_range;
    assert.deepEqual(samples[0].input_ids.slice(0, 4), rows()[0].input_ids.slice(start, end));
    assert.equal(manifest.corpus_sha256, createHash('sha256').update(fixture('corpus.jsonl')).digest('hex'));
  });
}

test('truncation reduction requires the declared original count', () => {
  const samples = fixture('truncate-right/batch.jsonl').trim().split('\n').map(JSON.parse);
  for (const sample of samples) delete sample.original_supervised_tokens;
  assert.equal(audit(samples).report.findings.some(f => f.code === 'SUPERVISION_REDUCED'), false);
  samples[0].original_supervised_tokens = 3;
  assert.equal(audit(samples).report.findings.some(f => f.code === 'INVALID_BASELINE'), true);
});

test('equal-size left and right truncation is count-stable, not content-identical', () => {
  const documents = ['left', 'right'].map(side => audit(fixture(`truncate-${side}/batch.jsonl`).trim().split('\n').map(JSON.parse)).document);
  assert.notDeepEqual(documents[0].samples[0].input_ids, documents[1].samples[0].input_ids);
  const response = JSON.parse(compare_json(...documents.map(document => JSON.stringify(document))));
  assert.equal(response.ok, true);
  assert.deepEqual(response.comparison.samples.map(s => s.change), ['stable', 'stable', 'stable']);
});
