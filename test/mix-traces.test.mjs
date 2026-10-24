import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, readFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';

const root = new URL('../', import.meta.url);
const run = (args, cwd = root) => spawnSync(process.execPath, ['scripts/mix-traces.mjs', ...args], {
  cwd,
  encoding: 'utf8',
});

test('mix-traces builds a deterministic rendered batch with prefixed ids', () => {
  const first = run(['examples/traces/mix-demo.json']);
  const second = run(['examples/traces/mix-demo.json']);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(first.stdout, second.stdout);
  const mixed = JSON.parse(first.stdout);
  assert.equal(mixed.schema, 'rendered-traces-utf16-v1');
  assert.equal(mixed.rows.length, 2);
  assert.ok(mixed.rows.every(row => row.id.startsWith('demo-')));
  assert.equal(new Set(mixed.rows.map(row => row.id)).size, 2);
});

test('mix-traces rejects colliding ids and short sources', () => {
  const temp = mkdtempSync(join(tmpdir(), 'mix-traces-'));
  try {
    const source = join(temp, 'one.json');
    writeFileSync(source, JSON.stringify({
      schema: 'rendered-traces-utf16-v1',
      template_family: 'chatml-typed-v1',
      tokenizer_source: 'authored',
      template_source: 'authored',
      rows: [{id: 'a', source: 'x', text: 't', input_ids: [1, 2], attention_mask: [1, 1], offsets: [{start: 0, end: 1}, {start: 1, end: 2}], candidates: []}],
    }));
    const mix = join(temp, 'mix.json');
    writeFileSync(mix, JSON.stringify({
      schema: 'supervision-audit/mix-v1',
      output_schema: 'rendered-traces-utf16-v1',
      seed: 1,
      sources: [
        {path: source, take: 1, id_prefix: 'p-'},
        {path: source, take: 1, id_prefix: 'p-'},
      ],
    }));
    const collide = run([mix]);
    assert.equal(collide.status, 2);
    assert.match(collide.stderr, /duplicate id/);
    writeFileSync(mix, JSON.stringify({
      schema: 'supervision-audit/mix-v1',
      output_schema: 'rendered-traces-utf16-v1',
      seed: 1,
      sources: [{path: source, take: 2}],
    }));
    const short = run([mix]);
    assert.equal(short.status, 2);
    assert.match(short.stderr, /need 2/);
  } finally {
    rmSync(temp, {recursive: true, force: true});
  }
});
