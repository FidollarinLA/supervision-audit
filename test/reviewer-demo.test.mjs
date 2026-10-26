import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const rootDir = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));

test('reviewer demo emits gated training jsonl and evidence summary', () => {
  const run = spawnSync(process.execPath, ['scripts/reviewer-demo.mjs'], {
    cwd: rootDir,
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.match(run.stdout, /Reviewer demo passed/);
  const evidence = JSON.parse(readFileSync(join(rootDir, 'artifacts/reviewer-demo/evidence.json'), 'utf8'));
  assert.equal(evidence.schema, 'supervision-audit/reviewer-demo/v1');
  assert.equal(evidence.scenarios.default_assistant_all.effective_targets, 45);
  assert.equal(evidence.scenarios.final_only.effective_targets, 24);
  assert.equal(evidence.scenarios.truncate_right_192.effective_targets, 33);
  assert.equal(evidence.scenarios.truncate_complete_turns_180.ok, true);
  assert.equal(evidence.scenarios.mix_demo.rows, 2);
  assert.equal(evidence.scenarios.zephyr_typed_demo.template_family, 'zephyr-typed-v1');
  assert.equal(evidence.scenarios.zephyr_typed_demo.effective_targets, 1);
  const trainingPath = join(rootDir, 'artifacts/reviewer-demo/training.jsonl');
  assert.equal(existsSync(trainingPath), true);
  const rows = readFileSync(trainingPath, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => Array.isArray(row.input_ids) && Array.isArray(row.labels)));
});

test('product hub is the default entry and audit lives under /audit.html', async () => {
  const {createStaticServer} = await import('../scripts/server.mjs');
  const {once} = await import('node:events');
  const server = createStaticServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const base = 'http://127.0.0.1:' + server.address().port;
    const hub = await fetch(base + '/');
    assert.equal(hub.status, 200);
    const hubText = await hub.text();
    assert.match(hubText, /训练数据准备与监督验证/);
    assert.match(hubText, /prepare\.html/);
    assert.match(hubText, /audit\.html/);
    assert.match(hubText, /评审验收清单/);
    assert.match(hubText, /demo:reviewer/);
    assert.doesNotMatch(hubText, /id="run"/);
    const audit = await fetch(base + '/audit.html');
    assert.equal(audit.status, 200);
    assert.match(await audit.text(), /id="run"/);
    const prepare = await fetch(base + '/prepare.html');
    assert.equal(prepare.status, 200);
    const prepareText = await prepare.text();
    assert.match(prepareText, /训练数据准备/);
    assert.match(prepareText, /id="policy-preset"/);
    const presets = await fetch(base + '/traces/presets.json');
    assert.equal(presets.status, 200);
    assert.equal((await presets.json()).schema, 'supervision-audit/policy-presets/v1');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
