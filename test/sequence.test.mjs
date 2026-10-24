import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {prepare_labels_json,prepare_training_json,audit_json} from '../web/preparation-engine.js';

const read=name=>JSON.parse(readFileSync(new URL('../examples/traces/'+name,import.meta.url),'utf8'));
const sources={'qwen-native':read('qwen-rendered.json'),'authored-reasoning':read('reasoning-rendered.json')};
const defaults=read('assistant-all.json');
const bounded=(input,limits,policy=defaults)=>JSON.parse(prepare_training_json(JSON.stringify(input),JSON.stringify(policy),JSON.stringify(limits)));

test('bounded preparation preserves independently frozen Teich labels at every tested prefix',t=>{
  let matches=0,empty=0;
  for(const oracle of read('teich-label-reference.json').cases.filter(row=>!row.reject)) {
    const input=structuredClone(sources[oracle.backend]);
    input.rows=input.rows.filter(row=>row.id===oracle.id);
    const n=oracle.labels.length;
    for(const max_length of new Set([2,8,Math.ceil(n/2),n-1,n,n+1])) {
      const result=bounded(input,{max_length,overflow:'truncate-right'},oracle.policy);
      const prefix=oracle.labels.slice(0,max_length);
      const kept=prefix.filter((v,i)=>i>0 && v!==-100).length;
      if(!kept) {assert.equal(result.ok,false);assert.match(result.error,/no effective targets/);assert.equal(result.document,undefined);empty++;continue;}
      assert.equal(result.ok,true,result.error);
      const sample=result.document.samples[0],summary=result.sequence_summary.samples[0];
      assert.deepEqual(sample.labels,prefix,`${oracle.backend}/${oracle.id}/${max_length}`);
      assert.deepEqual(sample.input_ids,input.rows[0].input_ids.slice(0,max_length));
      assert.deepEqual(sample.attention_mask,input.rows[0].attention_mask.slice(0,max_length));
      assert.deepEqual(sample.expected_supervision.mask,prefix.map((v,i)=>i>0&&v!==-100?1:0));
      assert.equal(result.report.status,'pass');
      assert.deepEqual(JSON.parse(audit_json(JSON.stringify(result.document))).report,result.report);
      assert.equal(summary.kept_targets,kept);
      assert.equal(summary.removed_targets,oracle.labels.filter(v=>v!==-100).length-kept);
      assert.equal(summary.removed_tokens,n-prefix.length);
      assert.equal(result.coverage[0].effective_targets,kept);
      for(const span of [...sample.spans,...sample.segments])assert.ok(span.start<span.end && span.end<=prefix.length);
      matches++;
    }
  }
  assert.ok(matches>60);assert.ok(empty>20);
  t.diagnostic(`${matches} exact Teich-label prefixes; ${empty} empty-target prefixes rejected`);
});

test('length overflow rejects by policy, unchanged lengths preserve original evidence',()=>{
  const input=sources['qwen-native'];
  const n=Math.max(...input.rows.map(row=>row.input_ids.length));
  const original=JSON.parse(prepare_labels_json(JSON.stringify(input),JSON.stringify(defaults)));
  const same=bounded(input,{max_length:n,overflow:'reject'});
  assert.deepEqual(same.document,original.document);
  assert.deepEqual(same.report,original.report);
  assert.deepEqual(same.coverage,original.coverage);
  assert.equal(same.sequence_summary.truncated_samples,0);
  const rejected=bounded(input,{max_length:n-1,overflow:'reject'});
  assert.equal(rejected.ok,false);assert.match(rejected.error,/exceed max_length/);
  assert.equal(rejected.document,undefined);
});

test('invalid limits and malformed discarded suffixes cannot be concealed by truncation',()=>{
  for(const limits of [null,[],{}, {max_length:0,overflow:'reject'},{max_length:1,overflow:'reject'},{max_length:100001,overflow:'reject'},{max_length:2.5,overflow:'reject'},{max_length:'8',overflow:'reject'},{max_length:8,overflow:'left'},{max_length:8,overflow:'reject',typo:true}]) {
    const r=bounded(sources['qwen-native'],limits);assert.equal(r.ok,false);assert.equal(r.document,undefined);
  }
  const input=structuredClone(sources['qwen-native']);
  input.rows[1].input_ids[input.rows[1].input_ids.length-1]=-7;
  const r=bounded(input,{max_length:80,overflow:'truncate-right'});
  assert.equal(r.ok,false);assert.match(r.error,/invalid token/);assert.equal(r.document,undefined);
});

test('a later empty prefix rejects the whole batch and never overwrites a previous training file',()=>{
  const temp=mkdtempSync(join(tmpdir(),'training-limit-'));
  try {
    const input=structuredClone(sources['qwen-native']);
    const first=input.rows[0];
    const at=first.candidates.find(span=>span.kind==='final_answer').source_start;
    const limit=first.offsets.findIndex(offset=>offset.end>at)+2;
    assert.ok(limit>=2);
    const later=structuredClone(first);later.id='later';
    later.candidates=[{start:later.text.length-1,end:later.text.length,source_start:later.text.length-1,source_end:later.text.length,kind:'final_answer',role:'assistant'}];
    input.rows=[first,later];
    const file=join(temp,'rendered.json'),out=join(temp,'training.jsonl');
    writeFileSync(file,JSON.stringify(input));writeFileSync(out,'existing-training');
    const r=spawnSync(process.execPath,['prepare.mjs',file,'--rendered','--max-length',String(limit),'--overflow','truncate-right','--emit','jsonl','--out',out],{cwd:new URL('../',import.meta.url),encoding:'utf8'});
    assert.equal(r.status,2,r.stderr);assert.match(r.stderr,/Row later:.*no effective targets/);
    assert.equal(readFileSync(out,'utf8'),'existing-training');
  } finally {rmSync(temp,{recursive:true,force:true});}
});

test('CLI exports the audited prefix and reports loss; rejects ambiguous or malformed options',()=>{
  const run=args=>spawnSync(process.execPath,['prepare.mjs','examples/traces/qwen-rendered.json','--rendered',...args],{cwd:new URL('../',import.meta.url),encoding:'utf8'});
  const expected=bounded(sources['qwen-native'],{max_length:192,overflow:'truncate-right'});
  assert.equal(expected.ok,true,expected.error);
  const r=run(['--max-length','192','--overflow','truncate-right','--emit','jsonl']);
  assert.equal(r.status,0,r.stderr);
  assert.deepEqual(r.stdout.trim().split('\n').map(JSON.parse),expected.document.samples.map(({id,input_ids,labels,attention_mask})=>({id,input_ids,labels,attention_mask})));
  assert.match(r.stderr,/training targets removed/);
  for(const args of [['--max-length','80'],['--overflow','truncate-right'],['--max-length','2.5'],['--max-length','1e3'],['--max-length','80','--overflow','left'],['--max-length','80','--max-length','90']])assert.equal(run(args).status,2);
  const raw=spawnSync(process.execPath,['prepare.mjs','examples/traces/raw.json','--normalize','--max-length','80'],{cwd:new URL('../',import.meta.url),encoding:'utf8'});
  assert.equal(raw.status,2);
});

test('complete-turn overflow keeps the last full assistant turn and refuses mid-answer cuts',()=>{
  const row=structuredClone(sources['qwen-native']);
  row.rows=row.rows.slice(0,1);
  const full=JSON.parse(prepare_labels_json(JSON.stringify(row),JSON.stringify(defaults)));
  assert.equal(full.ok,true,full.error);
  const assistantEnds=full.document.samples[0].spans.filter(span=>span.role==='assistant').map(span=>span.end);
  assert.ok(assistantEnds.length>=2);
  const firstEnd=assistantEnds[0];
  const secondEnd=assistantEnds[1];
  const kept=bounded(row,{max_length:secondEnd-1,overflow:'truncate-complete-turns'});
  assert.equal(kept.ok,true,kept.error);
  assert.equal(kept.document.samples[0].input_ids.length,firstEnd);
  assert.match(kept.sequence_summary.boundary,/complete-turn/);
  assert.match(kept.document.samples[0].expected_supervision.source,/complete-turn-max=/);
  const mid=bounded(row,{max_length:Math.max(2,firstEnd-1),overflow:'truncate-complete-turns'});
  assert.equal(mid.ok,false);
  assert.match(mid.error,/no complete assistant\/text turn/);
  const temp=mkdtempSync(join(tmpdir(),'complete-turn-'));
  try {
    const file=join(temp,'one-row.json');
    writeFileSync(file,JSON.stringify(row));
    const cli=spawnSync(process.execPath,['prepare.mjs',file,'--rendered','--max-length',String(secondEnd-1),'--overflow','truncate-complete-turns','--emit','jsonl'],{cwd:new URL('../',import.meta.url),encoding:'utf8'});
    assert.equal(cli.status,0,cli.stderr);
    assert.match(cli.stderr,/complete-turn/);
  } finally {rmSync(temp,{recursive:true,force:true});}
});
