import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compare_json,audit_jsonl} from '../web/engine.js';
const load=name=>readFileSync(new URL('../examples/'+name+'.json',import.meta.url),'utf8');
test('correcting role leakage resolves an indexed diagnostic',()=>{
 const r=JSON.parse(compare_json(load('role-leak'),load('healthy')));
 assert.equal(r.ok,true);assert.equal(r.comparison.before_status,'fail');assert.equal(r.comparison.after_status,'pass');
 assert.ok(r.comparison.resolved_findings.some(f=>f.code==='ROLE_POLICY_VIOLATION'&&f.token_index===1));
 assert.equal(r.comparison.samples[0].supervised_delta,-1);
});
test('duplicate sample IDs and incompatible policies refuse comparison',()=>{
 const d=JSON.parse(load('healthy'));d.samples.push(structuredClone(d.samples[0]));assert.equal(JSON.parse(compare_json(JSON.stringify(d),load('healthy'))).ok,false);
 d.samples.pop();d.allowed_roles=['assistant','user'];assert.equal(JSON.parse(compare_json(JSON.stringify(d),load('healthy'))).ok,false);
});
test('JSONL preserves unknowns and rejects truncated rows',()=>{
 const rows='{"input_ids":[1,2],"labels":[-100,2],"attention_mask":[1,1]}\n';
 const r=JSON.parse(audit_jsonl(rows,'["assistant"]'));assert.equal(r.report.status,'review');assert.equal(r.report.unknown_count,2);
 assert.equal(JSON.parse(audit_jsonl(rows+'{','["assistant"]')).ok,false);
 assert.deepEqual(r.document.samples[0].spans,[]);
 assert.equal(r.document.samples[0].id,'row-1');
 assert.deepEqual(r.document.allowed_roles,['assistant']);
});
test('pretraining repair resolves padding and packed boundary evidence',()=>{
 const result=JSON.parse(compare_json(load('pretraining-boundary'),load('pretraining')));
 assert.equal(result.ok,true);
 assert.equal(result.comparison.after_status,'pass');
 assert.deepEqual(result.comparison.resolved_findings.map(f=>f.code).sort(),['PACKING_CROSS_SOURCE_TARGET','PADDING_SUPERVISED']);
});
test('excessive interval expansion is refused instead of producing a partial pass',()=>{
 const d=JSON.parse(load('healthy'));const s=d.samples[0];s.input_ids=Array(10000).fill(1);s.labels=Array(10000).fill(-100);s.attention_mask=Array(10000).fill(1);s.spans=Array.from({length:11},()=>({start:0,end:10000,role:'assistant'}));s.segments=[];
 const normal=JSON.parse(load('healthy'));
 assert.equal(JSON.parse(compare_json(JSON.stringify(d),JSON.stringify(normal))).ok,false);
});
