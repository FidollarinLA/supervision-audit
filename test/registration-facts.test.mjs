import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));

test('registration facts emit measurable evidence without drafting form prose', () => {
  const run = spawnSync(process.execPath, ['scripts/registration-facts.mjs'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.match(run.stdout, /not a form draft|Registration facts written/i);
  const path = join(root, 'artifacts/registration-facts/facts.json');
  assert.equal(existsSync(path), true);
  const facts = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(facts.schema, 'supervision-audit/registration-facts/v1');
  assert.equal(facts.measurable.qwen_assistant_all_targets, 45);
  assert.equal(facts.measurable.qwen_final_only_targets, 24);
  assert.equal(facts.measurable.zephyr_typed_demo_targets, 1);
  assert.equal(facts.measurable.zephyr_template_family, 'zephyr-typed-v1');
  assert.ok(Array.isArray(facts.contestant_only));
  assert.ok(facts.contestant_only.some((row) => /self-authored|本人|Contest form|form narrative/i.test(row) || /Official form/.test(row)));
  assert.doesNotMatch(JSON.stringify(facts), /我保证已通过终审|官方已录取/);
});
