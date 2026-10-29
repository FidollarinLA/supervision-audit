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
  assert.equal(facts.measurable.qwen_truncate_right_192_targets, 33);
  assert.equal(facts.measurable.qwen_complete_turns_200_status, 'pass');
  assert.equal(facts.measurable.zephyr_typed_demo_targets, 1);
  assert.equal(facts.measurable.zephyr_template_family, 'zephyr-typed-v1');
  assert.equal(facts.surface_checks.prepare_has_length_demos, true);
  assert.equal(facts.surface_checks.prepare_has_mix_demo, true);
  assert.equal(facts.surface_checks.mixed_rendered_fixture, true);
  assert.equal(facts.surface_checks.reviewer_pack_doc, true);
  assert.equal(facts.surface_checks.architecture_runtime_doc, true);
  assert.equal(facts.surface_checks.prepare_has_next_strip, true);
  assert.equal(facts.surface_checks.prepare_has_policy_compare, true);
  assert.equal(facts.surface_checks.architecture_policy_compare_doc, true);
  assert.equal(facts.surface_checks.acceptance_gate_doc, true);
  assert.equal(facts.surface_checks.readme_moonc_floor, true);
  assert.equal(facts.surface_checks.hub_has_accept_cmd, true);
  assert.equal(facts.surface_checks.hub_has_gate_strip, true);
  assert.ok(facts.docs_to_cite.includes('docs/REVIEWER_PACK.md'));
  assert.ok(Array.isArray(facts.contestant_only));
  assert.ok(facts.contestant_only.some((row) => /self-authored|本人|Contest form|form narrative/i.test(row) || /Official form/.test(row)));
  assert.doesNotMatch(JSON.stringify(facts), /我保证已通过终审|官方已录取/);
});
