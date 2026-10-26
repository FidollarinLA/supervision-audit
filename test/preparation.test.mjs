import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {normalize_traces_json,prepare_labels_json,audit_json} from '../web/preparation-engine.js';

const policy={train_on_reasoning:true,train_on_final_answers:true,train_on_tools:true,train_on_user:false,train_on_system:false,train_on_tool_responses:false};
const raw=()=>JSON.parse(readFileSync(new URL('../examples/traces/raw.json',import.meta.url),'utf8'));
const normalize=data=>JSON.parse(normalize_traces_json(JSON.stringify(data)));
const fixture=()=>({schema:'rendered-traces-utf16-v1',template_family:'chatml-typed-v1',tokenizer_source:'authored-test-tokenizer',template_source:'authored-chatml',rows:[{
  id:'one',source:'authored-test',text:'U abc XYZ',input_ids:[10,11,12,13,14],attention_mask:[1,1,1,1,0],
  offsets:[{start:0,end:1},{start:2,end:5},{start:5,end:7},{start:6,end:9},{start:9,end:9}],
  candidates:[{start:0,end:1,source_start:0,source_end:1,kind:'user',role:'user'},
    {start:2,end:5,source_start:2,source_end:5,kind:'reasoning',role:'assistant'},
    {start:6,end:9,source_start:6,source_end:9,kind:'final_answer',role:'assistant'}]}]});
const prepare=(data,p=policy)=>JSON.parse(prepare_labels_json(JSON.stringify(data),JSON.stringify(p)));

test('normalization preserves multi-turn text and decodes function arguments',()=>{
  const r=normalize(raw());assert.equal(r.ok,true);assert.equal(r.rows.length,2);
  assert.deepEqual(r.rows[1].messages[2].tool_calls[0].function.arguments,{name:'MoonBit'});
  assert.equal(r.rows[0].messages[3].content,'请用中文回答 🌓');
  const data=raw(), calls=data.rows[1].messages[2].tool_calls;
  calls.push({...structuredClone(calls[0]),id:'call-2'});
  data.rows[1].messages.splice(4,0,{role:'tool',tool_call_id:'call-2',content:'Second result.'});
  assert.equal(normalize(data).ok,true,'parallel calls matched by ID');
});

test('incomplete traces, undeclared tools, missing required arguments and unsupported input reject',()=>{
  for (const edit of [
    d=>d.rows.push(structuredClone(d.rows[0])),
    d=>delete d.rows[0].source,
    d=>d.rows[1].messages[3].tool_call_id='wrong',
    d=>d.rows[1].messages.pop(),
    d=>d.rows[1].messages[2].tool_calls[0].function.name='unknown',
    d=>d.rows[1].messages[2].tool_calls[0].function.arguments='{}',
    d=>d.rows[1].messages[2].tool_calls[0].function.arguments='[]',
    d=>d.rows[0].messages[0].content=[{type:'image_url',image_url:'x'}],
    d=>d.rows[0].messages[0].role='developer',
  ]) { const data=raw();edit(data);assert.equal(normalize(data).ok,false); }
});

test('label assembly uses complete token containment, explicit policy and padding; existing audit is reused',()=>{
  const result=prepare(fixture());assert.equal(result.ok,true);assert.equal(result.report.status,'pass');
  assert.deepEqual(result.document.samples[0].labels,[-100,11,-100,13,-100]);
  assert.deepEqual(result.report.samples[0].effective_target_indices,[1,3]);
  assert.deepEqual(JSON.parse(audit_json(JSON.stringify(result.document))).report,result.report);
  const final=prepare(fixture(),{...policy,train_on_reasoning:false});
  assert.deepEqual(final.document.samples[0].labels,[-100,-100,-100,13,-100]);
  assert.equal(prepare(fixture(),{...policy,train_on_reasoning:false,train_on_final_answers:false}).ok,false);
});

test('zephyr-typed-v1 family is accepted; unknown families still reject',()=>{
  const zephyr=JSON.parse(readFileSync(new URL('../examples/traces/zephyr-rendered.json',import.meta.url),'utf8'));
  const ok=prepare(zephyr);assert.equal(ok.ok,true);assert.equal(ok.report.effective_target_count,1);
  const unknown=structuredClone(zephyr);unknown.template_family='invented-typed-v1';
  assert.equal(prepare(unknown).ok,false);
});

test('malformed offsets, missing evidence, duplicate IDs and unsupported candidate kinds reject atomically',()=>{
  for (const edit of [
    d=>d.rows[0].offsets[1].end=10,
    d=>d.rows[0].offsets[2].start=0,
    d=>d.rows[0].attention_mask.pop(),
    d=>d.rows[0].input_ids[1]=-1,
    d=>d.rows[0].candidates[0].kind='invented',
    d=>d.rows[0].candidates[0].role='assistant',
    d=>d.rows[0].candidates[0].source_start=-1,
    d=>d.rows.push(structuredClone(d.rows[0])),
    d=>d.tokenizer_source='',
  ]) {const data=fixture();edit(data);const r=prepare(data);assert.equal(r.ok,false);assert.equal(r.document,undefined);}
});

test('CLI rejects conflicting modes and input overwrite, exposes normalize result',()=>{
  const run=args=>spawnSync(process.execPath,['prepare.mjs',...args],{cwd:new URL('../',import.meta.url),encoding:'utf8'});
  const valid=run(['examples/traces/raw.json','--normalize']);assert.equal(valid.status,0,valid.stderr);assert.equal(JSON.parse(valid.stdout).schema,'normalized-traces-v1');
  assert.equal(run(['examples/traces/raw.json','--normalize','--rendered']).status,2);
  const refused=run(['examples/traces/raw.json','--normalize','--out','examples/traces/raw.json']);
  assert.equal(refused.status,2);assert.match(refused.stderr,/overwrite/);
});

test('frozen outputs of public Teich mask_data match actual MoonBit labels across typed policies',()=>{
  const load=file=>JSON.parse(readFileSync(new URL('../examples/traces/'+file,import.meta.url),'utf8'));
  const documents={'qwen-native':load('qwen-rendered.json'),'authored-reasoning':load('reasoning-rendered.json')};
  const oracle=load('teich-label-reference.json');
  assert.equal(oracle.cases.length,30);
  for (const c of oracle.cases) {
    const source=documents[c.backend];const actual=prepare({...source,rows:source.rows.filter(row=>row.id===c.id)},c.policy);
    if(c.reject){assert.equal(actual.ok,false);assert.match(actual.error,/no effective targets/);}
    else {assert.equal(actual.report.status,'pass');assert.deepEqual(actual.document.samples[0].labels,c.labels,`${c.backend}/${c.id}`);}
  }
});
