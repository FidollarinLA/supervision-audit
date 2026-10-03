import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const cwd = new URL('../', import.meta.url);
const run = args => spawnSync(process.execPath, ['cli.mjs', ...args], { cwd, encoding: 'utf8' });

test('summary preserves machine JSON and all audit exit statuses', () => {
  for (const [name, code, label] of [['healthy', 0, '通过'], ['role-leak', 1, '失败'], ['missing-provenance', 3, '需复核']]) {
    const original = run([`examples/${name}.json`]);
    const shown = run([`examples/${name}.json`, '--summary']);
    assert.equal(shown.status, code);
    assert.equal(shown.stdout, original.stdout);
    assert.equal(original.stderr, '');
    assert.match(shown.stderr, new RegExp(`审计结果：${label}`));
    const report = JSON.parse(shown.stdout).report;
    assert.ok(shown.stderr.includes(`声明监督标签 ${report.supervised_tokens}`));
  }
});

test('comparison summary does not present successful execution as audit pass', () => {
  const result = run(['examples/role-leak.json', '--baseline', 'examples/healthy.json', '--summary']);
  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).comparison.after_status, 'fail');
  assert.match(result.stderr, /通过 → 失败/);
  assert.match(result.stderr, /不表示数据通过审计/);
});

test('CLI rejects silently ignored, ambiguous or incomplete arguments before writing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'audit-cli-'));
  try {
    const output = join(dir, 'existing.json');
    writeFileSync(output, 'keep this report');
    for (const args of [
      ['--typo'], ['--roles', 'text'], ['--jsonl', '--baseline', 'examples/healthy.json'],
      ['--summary', '--summary'], ['second.json'], ['--jsonl', '--roles', 'text,,assistant'],
      ['--roles'], ['--baseline'], ['--out'],
    ]) {
      const result = run(['examples/healthy.json', '--out', output, ...args]);
      assert.equal(result.status, 2, JSON.stringify(args));
      assert.equal(result.stdout, '');
      assert.ok(result.stderr.length > 0);
      assert.equal(readFileSync(output, 'utf8'), 'keep this report');
    }
    for (const option of ['--out', '--baseline', '--roles']) {
      assert.equal(run(['examples/healthy.json', option, '--summary']).status, 2);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('summary works with report files, JSONL and malformed JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'audit-cli-'));
  try {
    const output = join(dir, 'report.json');
    const result = run(['examples/preprocessed.jsonl', '--jsonl', '--roles', 'assistant', '--out', output, '--summary']);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '');
    assert.equal(JSON.parse(readFileSync(output, 'utf8')).report.status, 'pass');
    assert.match(result.stderr, /审计结果：通过/);
    const bad = join(dir, 'bad.json');
    writeFileSync(bad, '{');
    const failed = run([bad, '--summary']);
    assert.equal(failed.status, 2);
    assert.equal(JSON.parse(failed.stdout).ok, false);
    assert.match(failed.stderr, /输入错误/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('summary bounds findings and escapes user-controlled terminal evidence', () => {
  const dir = mkdtempSync(join(tmpdir(), 'audit-cli-'));
  try {
    const doc = JSON.parse(readFileSync(new URL('../examples/role-leak.json', import.meta.url), 'utf8'));
    const sample = doc.samples[0];
    sample.id = 'injected\n\x1b[31m';
    doc.samples = Array.from({ length: 8 }, (_, i) => ({ ...sample, id: sample.id + i }));
    const file = join(dir, 'many.json');
    writeFileSync(file, JSON.stringify(doc));
    const result = run([file, '--summary']);
    assert.equal(result.status, 1);
    assert.equal(result.stderr.split('\n').filter(line => line.startsWith('- ')).length, 5);
    assert.match(result.stderr, /另有/);
    assert.ok(!result.stderr.includes('\x1b'));
    assert.ok(result.stderr.includes('injected\\n\\u001b'));
    assert.equal(JSON.parse(result.stdout).report.findings.length, 8);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
