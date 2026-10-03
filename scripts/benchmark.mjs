import { performance } from 'node:perf_hooks';
import { audit_json, compare_json } from '../web/engine.js';
const count = 3000;
const before = { contract: 'causal-lm-unshifted-v1', allowed_roles: ['text'], samples: [{
  id: 'synthetic-benchmark', input_ids: Array(count).fill(1),
  labels: [-100, ...Array(count - 1).fill(1)], attention_mask: [1, ...Array(count - 1).fill(0)],
  spans: [{ start: 0, end: count, role: 'text' }],
  segments: [{ start: 0, end: count, source_id: 'synthetic-A' }]
}] };
const after = structuredClone(before); after.samples[0].attention_mask.fill(1);
const a = JSON.stringify(before), b = JSON.stringify(after);
// Warm up; measure local deterministic checks, not a training workflow.
for (let i = 0; i < 3; i++) { audit_json(a); compare_json(a, b); }
function measure(operation) {
  const times = [];
  for (let i = 0; i < 10; i++) { const start = performance.now(); operation(); times.push(performance.now() - start); }
  times.sort((a, b) => a - b);
  return { median_ms: Number(((times[4] + times[5]) / 2).toFixed(2)), min_ms: Number(times[0].toFixed(2)), max_ms: Number(times.at(-1).toFixed(2)) };
}
console.log(JSON.stringify({ runtime: process.version, platform: process.platform, architecture: process.arch,
  synthetic: true, samples: 1, tokens: count, resolved_findings: count - 1, repetitions: 10,
  audit: measure(() => audit_json(a)), comparison: measure(() => compare_json(a, b)) }, null, 2));
