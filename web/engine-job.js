import { audit_json, audit_jsonl, compare_json } from './engine.js';
import {audit_json as auditPrepared,compare_json as comparePrepared} from './preparation-engine.js';
const prepared=text=>{try{return JSON.parse(text).samples?.some(s=>s.expected_supervision!==undefined)===true;}catch{return false;}};

// Dispatch and JSON I/O only. All audit and comparison decisions stay in MoonBit.
export function executeEngineJob(job) {
  if (job.kind === 'compare') return JSON.parse((prepared(job.before)||prepared(job.after)?comparePrepared:compare_json)(job.before,job.after));
  if (job.kind !== 'audit') throw new Error('Unknown background job');
  if (job.format === 'jsonl') return JSON.parse(audit_jsonl(job.text, JSON.stringify(job.policy)));
  if (job.format !== 'json') throw new Error('Unknown input format');
  const result = JSON.parse((prepared(job.text)?auditPrepared:audit_json)(job.text));
  if (result.ok) result.document = JSON.parse(job.text);
  return result;
}
