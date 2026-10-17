import {spawn} from 'node:child_process';
import {resolve as resolvePath,join} from 'node:path';
import {stat} from 'node:fs/promises';
import {normalize_traces_json, prepare_labels_json, prepare_training_json} from './web/preparation-engine.js';
import {readInputFile, writeProtectedReport} from './scripts/input-file.mjs';
import {reportSummary} from './web/report-summary.js';

const defaults = {train_on_reasoning:true, train_on_final_answers:true, train_on_tools:true,
  train_on_user:false, train_on_system:false, train_on_tool_responses:false};
const args = process.argv.slice(2);
if (!args.length || args.includes('--help')) {
  console.log('Usage: node prepare.mjs INPUT [--normalize | --rendered | --tokenizer LOCAL_DIR] [--python PYTHON] [--teich-source SOURCE_DIR] [--policy POLICY.json] [--max-length TOKENS [--overflow reject|truncate-right]] [--emit result|document|jsonl] [--out FILE]\nRaw OpenAI messages are validated by MoonBit; optional Teich/HF adapter renders the native template. Rendered input is offline. Training output is released only when the MoonBit gate passes. Length overflow rejects by default; right truncation is explicit and reports removed tokens/targets.');
  process.exit(args.includes('--help') ? 0 : 2);
}
try {
  const opts = new Map();
  for (let i = 1; i < args.length; i++) {
    const key = args[i];
    if (!['--normalize','--rendered','--tokenizer','--python','--teich-source','--policy','--emit','--out','--max-length','--overflow'].includes(key) || opts.has(key)) throw Error('Unknown or duplicate option: '+key);
    if (['--normalize','--rendered'].includes(key)) opts.set(key,true);
    else { const value = args[++i]; if (!value || value.startsWith('--')) throw Error(key+' requires a value'); opts.set(key,value); }
  }
  if ([opts.has('--normalize'),opts.has('--rendered'),opts.has('--tokenizer')].filter(Boolean).length !== 1) throw Error('Choose exactly one of --normalize, --rendered or --tokenizer');
  const emit = opts.get('--emit') || 'result';
  if (!['result','document','jsonl'].includes(emit)) throw Error('Invalid --emit value');
  if (opts.has('--normalize') && (opts.has('--policy') || emit !== 'result')) throw Error('--normalize only emits canonical raw traces');
  if (opts.has('--normalize') && (opts.has('--max-length') || opts.has('--overflow'))) throw Error('Sequence limits require label preparation');
  if (opts.has('--overflow') && !opts.has('--max-length')) throw Error('--overflow requires --max-length');
  let limits;
  if (opts.has('--max-length')) {
    const value=opts.get('--max-length');
    if (!/^\d+$/.test(value)) throw Error('--max-length requires an integer');
    limits={max_length:Number(value),overflow:opts.get('--overflow')||'reject'};
  }
  if (!opts.has('--tokenizer') && (opts.has('--python') || opts.has('--teich-source'))) throw Error('Renderer options require --tokenizer');
  const input = await readInputFile(args[0]);
  const policyFile = opts.has('--policy') ? await readInputFile(opts.get('--policy')) : null;
  const policy = policyFile ? JSON.parse(policyFile.text) : defaults;
  const adapterInputs=[];
  let result;
  if (opts.has('--normalize')) result = JSON.parse(normalize_traces_json(input.text));
  else {
    let rendered = input.text;
    if (!opts.has('--rendered')) {
      const normalized = JSON.parse(normalize_traces_json(input.text));
      if (!normalized.ok) throw Error(normalized.error);
      const tokenizer=resolvePath(opts.get('--tokenizer'));
      for(const name of ['tokenizer.json','tokenizer_config.json']){const path=join(tokenizer,name);adapterInputs.push({path,identity:await stat(path,{bigint:true})});}
      const command = ['integrations/teich/render.py','--tokenizer',tokenizer];
      if (opts.has('--teich-source')) command.push('--teich-source',resolvePath(opts.get('--teich-source')));
      const python=opts.get('--python') || process.env.PYTHON || 'python';
      rendered = await new Promise((resolve,reject) => {
        const child = spawn(python.includes('/') || python.includes('\\') ? resolvePath(python) : python, command,
          {cwd:new URL('./',import.meta.url), windowsHide:true, stdio:['pipe','pipe','pipe'], env:{...process.env, PYTHONUTF8:'1', HF_HUB_OFFLINE:'1', TRANSFORMERS_OFFLINE:'1'}});
        let output = '', errors = '', size = 0;
        const timer = setTimeout(() => { child.kill(); reject(Error('Template rendering exceeded 120 seconds')); },120000);
        child.on('error',error => {clearTimeout(timer);reject(error);});
        child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
        child.stdout.on('data',chunk => {size += Buffer.byteLength(chunk); if (size > 16*1024*1024) {child.kill();reject(Error('Rendered output exceeds 16 MiB'));} else output += chunk;});
        child.stderr.on('data',chunk => {if (errors.length < 16384) errors += chunk;});
        child.on('close',code => {clearTimeout(timer);code === 0 ? resolve(output) : reject(Error('Template adapter failed: '+errors.trim()));});
        child.stdin.on('error',()=>{});
        child.stdin.end(JSON.stringify(normalized));
      });
    }
    result = JSON.parse(limits ? prepare_training_json(rendered,JSON.stringify(policy),JSON.stringify(limits)) : prepare_labels_json(rendered,JSON.stringify(policy)));
  }
  if (!result.ok) throw Error(result.error);
  if (emit !== 'result' && result.report.status !== 'pass') throw Error('Training output blocked: '+result.report.status);
  const output = emit === 'document' ? result.document : result;
  const text = emit === 'jsonl' ? result.document.samples.map(({id,input_ids,labels,attention_mask}) => JSON.stringify({id,input_ids,labels,attention_mask})).join('\n')+'\n' : JSON.stringify(output,null,2)+'\n';
  if (opts.has('--out')) await writeProtectedReport(opts.get('--out'),text,[input,...(policyFile ? [policyFile] : []),...adapterInputs]);
  else process.stdout.write(text);
  if (result.report) console.error(reportSummary(result));
  if (result.sequence_summary) console.error(`Length control: ${result.sequence_summary.truncated_samples} truncated rows; ${result.sequence_summary.removed_tokens} tokens and ${result.sequence_summary.removed_targets} training targets removed. Right prefixes may end inside a message or tool call.`);
  process.exitCode = result.report ? result.report.status === 'fail' ? 1 : result.report.status === 'review' ? 3 : 0 : 0;
} catch (error) {console.error(error.message);process.exitCode = 2;}
