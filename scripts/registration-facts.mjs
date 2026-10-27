#!/usr/bin/env node
/**
 * Emit machine-checkable registration facts for the contestant to cite.
 * Does not draft the official form narrative; that must be self-authored.
 */
import {mkdirSync, writeFileSync, readFileSync, existsSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {prepare_labels_json, prepare_training_json} from '../web/preparation-engine.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'artifacts', 'registration-facts');
mkdirSync(outDir, {recursive: true});

function fail(message) {
  console.error(message);
  process.exit(1);
}

function load(rel) {
  return JSON.parse(readFileSync(join(root, rel), 'utf8'));
}

function targets(result) {
  return result.report?.effective_target_count ?? null;
}

const assistantAll = load('examples/traces/assistant-all.json');
const finalOnly = load('examples/traces/final-only.json');
const qwen = load('examples/traces/qwen-rendered.json');
const zephyr = load('examples/traces/zephyr-rendered.json');

const qwenAll = JSON.parse(prepare_labels_json(JSON.stringify(qwen), JSON.stringify(assistantAll)));
const qwenFinal = JSON.parse(prepare_labels_json(JSON.stringify(qwen), JSON.stringify(finalOnly)));
const zephyrAll = JSON.parse(prepare_labels_json(JSON.stringify(zephyr), JSON.stringify(assistantAll)));
if (!qwenAll.ok || targets(qwenAll) !== 45) fail('qwen assistant-all expected 45 targets');
if (!qwenFinal.ok || targets(qwenFinal) !== 24) fail('qwen final-only expected 24 targets');
if (!zephyrAll.ok || targets(zephyrAll) !== 1) fail('zephyr demo expected 1 target');
if (zephyr.template_family !== 'zephyr-typed-v1') fail('zephyr fixture family mismatch');

const qwenRight = JSON.parse(
  prepare_training_json(
    JSON.stringify(qwen),
    JSON.stringify(assistantAll),
    JSON.stringify({max_length: 192, overflow: 'truncate-right'}),
  ),
);
const qwenTurns = JSON.parse(
  prepare_training_json(
    JSON.stringify(qwen),
    JSON.stringify(assistantAll),
    JSON.stringify({max_length: 200, overflow: 'truncate-complete-turns'}),
  ),
);
if (!qwenRight.ok || targets(qwenRight) !== 33) fail('qwen truncate-right 192 expected 33 targets');
if (!qwenTurns.ok || qwenTurns.report.status !== 'pass') fail('qwen complete-turns 200 should pass');

const hub = readFileSync(join(root, 'web/index.html'), 'utf8');
const preparePage = readFileSync(join(root, 'web/prepare.html'), 'utf8');
const checks = {
  hub_is_workbench: /训练数据准备与监督验证/.test(hub) && /评审验收清单/.test(hub),
  prepare_has_presets: /id="policy-preset"/.test(preparePage),
  prepare_has_zephyr_demo: /id="load-zephyr"/.test(preparePage),
  prepare_has_mix_demo: /id="load-mix"/.test(preparePage),
  prepare_has_length_demos:
    /id="demo-truncate-right"/.test(preparePage) && /id="demo-complete-turns"/.test(preparePage),
  audit_is_separate: existsSync(join(root, 'web/audit.html')),
  reviewer_pack_doc: existsSync(join(root, 'docs/REVIEWER_PACK.md')),
  mixed_rendered_fixture: existsSync(join(root, 'examples/traces/mixed-rendered.json')),
};

for (const [name, ok] of Object.entries(checks)) {
  if (!ok) fail('surface check failed: ' + name);
}

const demo = spawnSync(process.execPath, ['scripts/reviewer-demo.mjs'], {
  cwd: root,
  encoding: 'utf8',
});
if (demo.status !== 0) fail('demo:reviewer failed: ' + (demo.stderr || demo.stdout));

const evidencePath = join(root, 'artifacts/reviewer-demo/evidence.json');
const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));

const gitSha = spawnSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'});
const localHead = gitSha.status === 0 ? gitSha.stdout.trim() : null;

const facts = {
  schema: 'supervision-audit/registration-facts/v1',
  generated_at: new Date().toISOString(),
  disclaimer:
    'Facts only. Contest form narrative must be written by the contestant; this file is not a submission.',
  positioning_one_liner_for_reference:
    'MoonBit training-data preparation and supervision verification workbench (Teich-aligned labels/gates).',
  local_git_head: localHead,
  surfaces: {
    hub: 'http://127.0.0.1:4317/',
    prepare: 'http://127.0.0.1:4317/prepare.html',
    audit_gate: 'http://127.0.0.1:4317/audit.html',
  },
  reproducible_commands: [
    'npm run build',
    'npm run demo:reviewer',
    'npm run facts:registration',
    'npm run dev',
  ],
  measurable: {
    qwen_assistant_all_targets: targets(qwenAll),
    qwen_final_only_targets: targets(qwenFinal),
    qwen_truncate_right_192_targets: targets(qwenRight),
    qwen_complete_turns_200_status: qwenTurns.report.status,
    qwen_complete_turns_200_targets: targets(qwenTurns),
    zephyr_typed_demo_targets: targets(zephyrAll),
    zephyr_template_family: zephyr.template_family,
    reviewer_demo_schema: evidence.schema,
    reviewer_demo_scenarios: Object.keys(evidence.scenarios || {}),
  },
  docs_to_cite: [
    'docs/REVIEWER_PACK.md',
    'docs/PRODUCT.md',
    'docs/architecture.md',
    'docs/review-response-2026-10-21.md',
    'docs/trainer-recipe.md',
    'docs/acceptance.md',
  ],
  contestant_only: [
    'Official form prose (no AI-authored final copy)',
    'Identity / integrity attestations',
    'Any external user trial notes (do not invent)',
  ],
  surface_checks: checks,
};

const outPath = join(outDir, 'facts.json');
writeFileSync(outPath, JSON.stringify(facts, null, 2) + '\n');

console.log('Registration facts written (not a form draft).');
console.log('- ' + outPath);
console.log('- Qwen assistant-all targets: ' + facts.measurable.qwen_assistant_all_targets);
console.log('- Qwen final-only targets: ' + facts.measurable.qwen_final_only_targets);
console.log('- Zephyr demo targets: ' + facts.measurable.zephyr_typed_demo_targets);
console.log('- Cite facts in your own words on the official form before the deadline.');
