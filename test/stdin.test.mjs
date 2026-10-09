import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { input_limit_utf16 } from '../web/engine.js';

const root = new URL('../', import.meta.url);
const fixture = name => readFileSync(new URL(`../examples/${name}`, import.meta.url), 'utf8');
const run = (args, input) => spawnSync(process.execPath, ['cli.mjs', ...args], {
  cwd: root, input, encoding: 'utf8', timeout: 10000, maxBuffer: 4 * 1024 * 1024,
});

test('stdin JSON matches file reports and preserves pass, fail and review exits', () => {
  for (const [name, code] of [['healthy.json', 0], ['role-leak.json', 1], ['missing-provenance.json', 3]]) {
    const file = run([`examples/${name}`], '');
    const stdin = run(['-', '--summary'], fixture(name));
    assert.equal(stdin.status, code, stdin.stderr);
    assert.deepEqual(JSON.parse(stdin.stdout), JSON.parse(file.stdout));
    assert.match(stdin.stderr, /审计结果/);
  }
});

test('stdin JSONL retains Unicode and declared supervision policy', () => {
  const row = { id: '样本🌙', input_ids: [10, 11], labels: [-100, 11], attention_mask: [1, 1] };
  const result = run(['-', '--jsonl', '--roles', 'text'], JSON.stringify(row) + '\n');
  assert.equal(result.status, 3, result.stderr);
  const report = JSON.parse(result.stdout).report;
  assert.equal(report.samples[0].id, row.id);
  assert.equal(report.prediction_targets, 1);
  assert.ok(report.findings.some(f => f.code === 'SOURCE_PROVENANCE_MISSING'));
});

test('comparison can read either side from stdin with unchanged comparison semantics', () => {
  const expected = run(['examples/pretraining.json', '--baseline', 'examples/pretraining-boundary.json'], '');
  for (const result of [
    run(['-', '--baseline', 'examples/pretraining-boundary.json'], fixture('pretraining.json')),
    run(['examples/pretraining.json', '--baseline', '-'], fixture('pretraining-boundary.json')),
  ]) {
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), JSON.parse(expected.stdout));
  }
});

test('stdin rejects malformed tails and never treats an oversized valid prefix as a pass', () => {
  const good = fixture('healthy.json');
  for (const input of ['', good + '\n{', good + ' '.repeat(input_limit_utf16())]) {
    const result = run(['-'], input);
    assert.equal(result.status, 2, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, false);
    assert.equal(output.report, undefined);
  }
});

test('double stdin is rejected before reading or overwriting an existing report', () => {
  const temp = mkdtempSync(join(tmpdir(), 'audit-stdin-'));
  try {
    const output = join(temp, 'existing.json');
    writeFileSync(output, 'keep existing report');
    const result = run(['-', '--baseline', '-', '--out', output], fixture('healthy.json'));
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Only one input can read stdin/);
    assert.equal(result.stdout, '');
    assert.equal(readFileSync(output, 'utf8'), 'keep existing report');
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test('stdin can export a full report while keeping summary on stderr', () => {
  const temp = mkdtempSync(join(tmpdir(), 'audit-stdin-out-'));
  try {
    const output = join(temp, 'report.json');
    const result = run(['-', '--out', output, '--summary'], fixture('healthy.json'));
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '');
    assert.equal(JSON.parse(readFileSync(output, 'utf8')).report.status, 'pass');
    assert.match(result.stderr, /审计结果：通过/);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
