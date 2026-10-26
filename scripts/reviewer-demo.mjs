#!/usr/bin/env node
/**
 * Five-minute reviewer path: preparation → gate → evidence summary.
 * Writes a machine-checkable JSON artifact; does not claim contest acceptance.
 */
import {mkdirSync, writeFileSync, readFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {prepare_labels_json, prepare_training_json, audit_json} from '../web/preparation-engine.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'artifacts', 'reviewer-demo');
const rendered = JSON.parse(readFileSync(join(root, 'examples/traces/qwen-rendered.json'), 'utf8'));
const assistantAll = JSON.parse(readFileSync(join(root, 'examples/traces/assistant-all.json'), 'utf8'));
const finalOnly = JSON.parse(readFileSync(join(root, 'examples/traces/final-only.json'), 'utf8'));
const toolsAnswers = JSON.parse(readFileSync(join(root, 'examples/traces/tools-and-answers.json'), 'utf8'));

function prepare(policy, limits) {
  const text = JSON.stringify(rendered);
  const policyText = JSON.stringify(policy);
  const raw = limits
    ? prepare_training_json(text, policyText, JSON.stringify(limits))
    : prepare_labels_json(text, policyText);
  return JSON.parse(raw);
}

function targets(result) {
  return result.report?.effective_target_count ?? null;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

mkdirSync(outDir, {recursive: true});

const defaultPrep = prepare(assistantAll);
if (!defaultPrep.ok || defaultPrep.report.status !== 'pass') fail('default preparation failed: ' + (defaultPrep.error || defaultPrep.report?.status));
if (targets(defaultPrep) !== 45) fail(`expected 45 default targets, got ${targets(defaultPrep)}`);

const finalPrep = prepare(finalOnly);
if (!finalPrep.ok || finalPrep.report.status !== 'pass') fail('final-only preparation failed');
if (targets(finalPrep) !== 24) fail(`expected 24 final-only targets, got ${targets(finalPrep)}`);

const toolsPrep = prepare(toolsAnswers);
if (!toolsPrep.ok || toolsPrep.report.status !== 'pass') fail('tools-and-answers preparation failed');

const truncated = prepare(assistantAll, {max_length: 192, overflow: 'truncate-right'});
if (!truncated.ok || truncated.report.status !== 'pass') fail('truncate-right failed: ' + truncated.error);
if (targets(truncated) !== 33) fail(`expected 33 truncated targets, got ${targets(truncated)}`);

const chatOnly = structuredClone(rendered);
chatOnly.rows = chatOnly.rows.slice(0, 1);
const chatLabeled = JSON.parse(prepare_labels_json(JSON.stringify(chatOnly), JSON.stringify(assistantAll)));
if (!chatLabeled.ok) fail('chat-only label prep failed');
const assistantEnds = chatLabeled.document.samples[0].spans
  .filter((span) => span.role === 'assistant')
  .map((span) => span.end);
if (assistantEnds.length < 2) fail('chat demo needs at least two assistant turns');
const turnLimit = assistantEnds[1] - 1;
const turns = JSON.parse(
  prepare_training_json(
    JSON.stringify(chatOnly),
    JSON.stringify(assistantAll),
    JSON.stringify({max_length: turnLimit, overflow: 'truncate-complete-turns'}),
  ),
);
if (!turns.ok || turns.report.status !== 'pass') fail('complete-turn failed: ' + (turns.error || turns.report?.status));
if (turns.document.samples[0].input_ids.length !== assistantEnds[0]) {
  fail(`complete-turn kept ${turns.document.samples[0].input_ids.length}, expected ${assistantEnds[0]}`);
}
const turnOk = true;

const mix = spawnSync(process.execPath, ['scripts/mix-traces.mjs', 'examples/traces/mix-demo.json'], {cwd: root, encoding: 'utf8'});
if (mix.status !== 0) fail('mix-traces failed: ' + mix.stderr);
const mixed = JSON.parse(mix.stdout);
if (mixed.rows?.length !== 2) fail('mix-demo should emit 2 rows');

const zephyr = JSON.parse(readFileSync(join(root, 'examples/traces/zephyr-rendered.json'), 'utf8'));
const zephyrPrep = JSON.parse(prepare_labels_json(JSON.stringify(zephyr), JSON.stringify(assistantAll)));
if (!zephyrPrep.ok || zephyrPrep.report.status !== 'pass') fail('zephyr-typed demo failed: ' + (zephyrPrep.error || zephyrPrep.report?.status));
if (targets(zephyrPrep) !== 1) fail(`expected 1 zephyr-demo target, got ${targets(zephyrPrep)}`);
if (zephyr.template_family !== 'zephyr-typed-v1') fail('zephyr fixture must declare zephyr-typed-v1');

const trainingPath = join(outDir, 'training.jsonl');
const jsonl = defaultPrep.document.samples
  .map(({id, input_ids, labels, attention_mask}) => JSON.stringify({id, input_ids, labels, attention_mask}))
  .join('\n') + '\n';
writeFileSync(trainingPath, jsonl);

const reaudit = JSON.parse(audit_json(JSON.stringify(defaultPrep.document)));
if (reaudit.report?.status !== 'pass') fail('prepared document failed re-audit');

const evidence = {
  schema: 'supervision-audit/reviewer-demo/v1',
  generated_at: new Date().toISOString(),
  positioning: 'training-data preparation and supervision verification workbench',
  teich_alignment: {
    template_adapter: 'optional pinned Teich/HF',
    label_crosscheck: 'see docs/measurements/teich-preparation-2026-10-13.json',
    complete_turn_policy: 'truncate-complete-turns mirrors trim_followups intent',
  },
  scenarios: {
    default_assistant_all: {ok: true, effective_targets: targets(defaultPrep), status: defaultPrep.report.status},
    final_only: {ok: true, effective_targets: targets(finalPrep), status: finalPrep.report.status},
    tools_and_answers: {ok: true, effective_targets: targets(toolsPrep), status: toolsPrep.report.status},
    truncate_right_192: {
      ok: true,
      effective_targets: targets(truncated),
      removed_tokens: truncated.sequence_summary.removed_tokens,
      removed_targets: truncated.sequence_summary.removed_targets,
    },
    truncate_complete_turns_180: {
      ok: turnOk,
      error: turns.error || null,
      effective_targets: turnOk ? targets(turns) : null,
      boundary: turns.sequence_summary?.boundary || null,
    },
    mix_demo: {ok: true, rows: mixed.rows.length, seed: mixed.seed},
    zephyr_typed_demo: {
      ok: true,
      template_family: zephyr.template_family,
      effective_targets: targets(zephyrPrep),
      note: 'project-authored WordLevel Zephyr-style fixture; not a Hub tokenizer',
    },
    reaudit_prepared_document: {ok: true, status: reaudit.report.status},
  },
  artifacts: {
    training_jsonl: 'artifacts/reviewer-demo/training.jsonl',
    hub: 'http://127.0.0.1:4317/',
    prepare: 'http://127.0.0.1:4317/prepare.html',
    audit_gate: 'http://127.0.0.1:4317/audit.html',
  },
  limits: [
    'Does not claim contest acceptance or model quality.',
    'Demo corpus is project-authored Qwen/Zephyr-style rendered traces, not production traffic.',
    'Teich live API verify remains optional and separate from this offline demo.',
  ],
};

writeFileSync(join(outDir, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
console.log('Reviewer demo passed.');
console.log(`- default targets: ${targets(defaultPrep)}`);
console.log(`- final-only targets: ${targets(finalPrep)}`);
console.log(`- truncate-right targets: ${targets(truncated)}`);
console.log(`- mix rows: ${mixed.rows.length}`);
console.log(`- evidence: artifacts/reviewer-demo/evidence.json`);
console.log(`- training jsonl: ${trainingPath}`);
console.log('Next: npm run dev → open / → 训练数据准备');
