import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {audit_json} from '../web/engine.js';
const load=name=>JSON.parse(readFileSync(new URL('../examples/'+name+'.json',import.meta.url),'utf8'));
const run=doc=>JSON.parse(audit_json(JSON.stringify(doc)));
for(const [name,status,code] of [['healthy','pass',null],['role-leak','fail','ROLE_POLICY_VIOLATION'],['padding-leak','fail','PADDING_SUPERVISED'],['packing-conflict','fail','SOURCE_OVERLAP'],['lost-supervision','review','SUPERVISION_REDUCED'],['missing-provenance','review','ROLE_PROVENANCE_MISSING']]){
 test('fixture '+name,()=>{const r=run(load(name));assert.equal(r.ok,true);assert.equal(r.report.status,status);if(code)assert.ok(r.report.findings.some(f=>f.code===code));});
}
test('JSON null and omitted baseline produce identical reports',()=>{const d=load('healthy');const a=run(d);delete d.samples[0].original_supervised_tokens;assert.deepEqual(run(d),a);});
test('bad input and unsupported label contracts fail clearly',()=>{assert.equal(JSON.parse(audit_json('{')).ok,false);const d=load('healthy');d.contract='shifted';assert.equal(run(d).report.status,'fail');assert.equal(run(d).report.samples.length,0);});
test('CLI exit codes distinguish pass, fail, review and input error',()=>{for(const [file,expected] of [['healthy',0],['role-leak',1],['missing-provenance',3]]){const r=spawnSync(process.execPath,['cli.mjs','examples/'+file+'.json'],{cwd:new URL('../',import.meta.url),encoding:'utf8'});assert.equal(r.status,expected,r.stderr);assert.equal(JSON.parse(r.stdout).ok,true);}const bad=spawnSync(process.execPath,['cli.mjs','missing.json'],{cwd:new URL('../',import.meta.url)});assert.equal(bad.status,2);});
test('independent per-token oracle agrees on 128 seeded policy combinations',()=>{
 let seed=20261002;const next=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
 for(let trial=0;trial<128;trial++){
  const ids=Array.from({length:16},(_,i)=>i+1),roles=ids.map(()=>['assistant','user'][next()%2]);
  const labels=ids.map((id,i)=>i===0?-100:next()%3===0?-100:id);
  const attention=ids.map(()=>next()%4===0?0:1);
  const allow=next()%2?['assistant']:['assistant','user'];
  const sample={id:'oracle',input_ids:ids,labels,attention_mask:attention,spans:roles.map((role,i)=>({start:i,end:i+1,role})),segments:[{start:0,end:16,source_id:'a'}]};
  const r=run({contract:'causal-lm-unshifted-v1',allowed_roles:allow,samples:[sample]}).report;
  const expected=[];
  for(let i=0;i<16;i++){if(labels[i]!==-100&&attention[i]===0)expected.push('PADDING_SUPERVISED@'+i);if(labels[i]!==-100&&!allow.includes(roles[i]))expected.push('ROLE_POLICY_VIOLATION@'+i);}
  const actual=r.findings.filter(f=>f.severity==='error').map(f=>f.code+'@'+f.token_index);
  assert.deepEqual(actual.sort(),expected.sort());
  assert.equal(r.supervised_tokens,labels.filter(x=>x!==-100).length);
 }
});
