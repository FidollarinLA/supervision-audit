import { audit_json, audit_jsonl, compare_json } from './engine.js';

// Dispatch and JSON I/O only. All audit and comparison decisions stay in MoonBit.
export function executeEngineJob(job) {
  if (job.kind === 'compare') return JSON.parse(compare_json(job.before, job.after));
  if (job.kind !== 'audit') throw new Error('Unknown background job');
  if (job.format === 'jsonl') return JSON.parse(audit_jsonl(job.text, JSON.stringify(job.policy)));
  if (job.format !== 'json') throw new Error('Unknown input format');
  const result = JSON.parse(audit_json(job.text));
  if (result.ok) result.document = JSON.parse(job.text);
  return result;
}
