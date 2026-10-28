import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {prepare_labels_json} from '../web/preparation-engine.js';

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const catalog = JSON.parse(readFileSync(join(root, 'examples/traces/presets.json'), 'utf8'));

function targets(renderedPath) {
  const rendered = readFileSync(join(root, renderedPath), 'utf8');
  return catalog.presets.map((preset) => {
    const policy = readFileSync(join(root, 'examples/traces', preset.file), 'utf8');
    const out = JSON.parse(prepare_labels_json(rendered, policy));
    return {id: preset.id, status: out.report.status, targets: out.report.effective_target_count};
  });
}

test('qwen demo presets expose the known review deltas', () => {
  const rows = targets('examples/traces/qwen-rendered.json');
  assert.deepEqual(
    rows.map((row) => [row.id, row.status, row.targets]),
    [
      ['assistant-all', 'pass', 45],
      ['final-only', 'pass', 24],
      ['tools-and-answers', 'pass', 45],
    ],
  );
});

test('reasoning demo presets diverge across all three catalog entries', () => {
  const rows = targets('examples/traces/reasoning-rendered.json');
  assert.deepEqual(
    rows.map((row) => [row.id, row.status, row.targets]),
    [
      ['assistant-all', 'pass', 199],
      ['final-only', 'pass', 78],
      ['tools-and-answers', 'pass', 155],
    ],
  );
  assert.equal(new Set(rows.map((row) => row.targets)).size, 3);
});
