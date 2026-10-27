import {AuditRunner} from './preparation-worker-client.js';
const $=id=>document.getElementById(id);
const keys=['train_on_reasoning','train_on_final_answers','train_on_tools','train_on_user','train_on_system','train_on_tool_responses'];
const runner=new AuditRunner();
let revision=0,normalized=null,normalizedText='',result=null,presetCatalog=[],applyingPreset=false;
function invalidate(){revision++;runner.cancel();if($('raw-input').value!==normalizedText)normalized=null;result=null;$('cancel-prepare').hidden=true;$('export-normalized').disabled=!normalized;
  for(const id of ['export-training','export-document','export-preparation','inspect-prepared'])$(id).disabled=true;
  $('prepare-results').hidden=true;$('prepare-metrics').replaceChildren();$('raw-status').textContent='输入或策略已变化，请重新运行。';$('prepare-status').textContent='';}
function markCustomPolicy(){if(applyingPreset)return;if($('policy-preset').value){$('policy-preset').value='';$('policy-preset-summary').textContent='已改为自定义勾选；请重新生成标签。';}invalidate();}
function applyPolicy(policy){for(const key of keys)$(key).checked=Boolean(policy[key]);}
async function loadPresets(){
  const response=await fetch('traces/presets.json');
  if(!response.ok)throw Error('策略预设清单加载失败');
  const catalog=await response.json();
  if(catalog.schema!=='supervision-audit/policy-presets/v1'||!Array.isArray(catalog.presets))throw Error('策略预设清单格式无效');
  presetCatalog=catalog.presets;
  const select=$('policy-preset');
  for(const preset of presetCatalog){const option=document.createElement('option');option.value=preset.id;option.textContent=preset.title;select.append(option);}
  await applyPreset('assistant-all');
}
async function applyPreset(id){
  if(!id){$('policy-preset-summary').textContent='自定义勾选：可单独开关六类监督内容。';invalidate();return;}
  const preset=presetCatalog.find(row=>row.id===id);
  if(!preset)throw Error('未知策略预设');
  const response=await fetch('traces/'+preset.file);
  if(!response.ok)throw Error('无法加载预设 '+preset.file);
  const policy=await response.json();
  applyingPreset=true;
  try{applyPolicy(policy);$('policy-preset').value=id;$('policy-preset-summary').textContent=preset.summary;invalidate();}
  finally{applyingPreset=false;}
}
function download(name,value,type='application/json'){const url=URL.createObjectURL(new Blob([typeof value==='string'?value:JSON.stringify(value,null,2)+'\n'],{type}));const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function readFile(input,target){const file=input.files[0];if(!file)return;invalidate();const ticket=revision;try{if(file.size>4*1024*1024)throw Error('文件超过 4 MiB');const text=new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer());if(ticket!==revision)return;$(target).value=text;}catch(error){if(ticket===revision)$('prepare-status').textContent=error.message;}}
function el(tag,text){const node=document.createElement(tag);node.textContent=String(text);return node;}
async function run(op){invalidate();const ticket=revision;$('cancel-prepare').hidden=false;const status=op==='normalize'?$('raw-status'):$('prepare-status');status.textContent='正在后台处理…';try{
  const length=$('max-length').value;
  if(op==='prepare' && length!=='' && !/^\d+$/.test(length))throw Error('序列长度必须是整数。');
  const limits=op==='prepare' && length!==''?{max_length:Number(length),overflow:$('overflow').value}:undefined;
  if(op==='prepare' && !limits && $('overflow').value!=='reject')throw Error('选择截断策略前，请填写每条最多 token。');
  const {result:output}=await runner.run({op,text:$(op==='normalize'?'raw-input':'rendered-input').value,policy:Object.fromEntries(keys.map(key=>[key,$(key).checked])),limits});
  if(ticket!==revision)return;
  if(op==='normalize'){normalized=output;normalizedText=$('raw-input').value;$('export-normalized').disabled=false;status.textContent=`已校验 ${output.rows.length} 条完整轨迹。下一步用目标模型模板分词。`;}
  else {result=output;const r=output.report;const pass=r.status==='pass';status.textContent=pass?'准备完成，训练门禁通过。可下载训练数据或查看逐 token 证据。':'门禁未通过，请下载报告并检查问题。';$('export-training').disabled=!pass;$('export-document').disabled=!pass;$('inspect-prepared').disabled=!pass;$('export-preparation').disabled=false;
    const cards=[['准备结果',pass?'通过':'需检查'],['输入样本',r.sample_count],['实际 token',r.token_count],['训练目标',r.effective_target_count]];
    $('prepare-metrics').replaceChildren(...cards.map(([title,value])=>{const node=el('div','');node.className='metric';node.append(el('small',title),el('strong',value));return node;}));
    const sequence=output.sequence_summary;
    if(sequence?.truncated_samples)status.textContent+=` 已截断 ${sequence.truncated_samples} 条，移除 ${sequence.removed_tokens} 个 token / ${sequence.removed_targets} 个训练目标。${sequence.boundary||''}`;
    $('prepared-samples').replaceChildren(...r.samples.map(sample=>{const tr=el('tr','');const tool=sample.effective_target_indices.filter(i=>sample.roles[i]==='tool').length;const change=sequence?.samples.find(row=>row.id===sample.id);tr.append(...[sample.id,sample.tokens,sample.effective_target_indices.length,tool,change?`${change.removed_tokens} / ${change.removed_targets}`:'0 / 0',sample.findings.length?'检查报告':'通过'].map(value=>el('td',value)));return tr;}));
    $('evidence-basis').textContent='标签按所供候选区间、token 偏移和当前策略生成。报告中的预期掩码来自同一准备策略；独立交叉验证另见项目的 Teich 验证记录。';
    $('prepared-source').textContent='Tokenizer：'+output.tokenizer_source+' · 模板：'+output.template_source;$('prepare-results').hidden=false;}
}catch(error){if(ticket===revision && error.name!=='AbortError')status.textContent='无法处理：'+error.message;}finally{if(ticket===revision)$('cancel-prepare').hidden=true;}}
$('normalize').onclick=()=>run('normalize');$('prepare').onclick=()=>run('prepare');$('cancel-prepare').onclick=()=>{invalidate();$('prepare-status').textContent='已取消。';};
$('raw-input').oninput=invalidate;$('rendered-input').oninput=invalidate;for(const key of keys)$(key).onchange=markCustomPolicy;
$('max-length').oninput=invalidate;$('overflow').onchange=invalidate;
$('policy-preset').onchange=async()=>{try{await applyPreset($('policy-preset').value);}catch(error){$('prepare-status').textContent=error.message;}};
$('raw-file').onchange=()=>readFile($('raw-file'),'raw-input');$('rendered-file').onchange=()=>readFile($('rendered-file'),'rendered-input');
$('export-normalized').onclick=()=>{if(normalized)download('normalized-traces.json',normalized);};
$('export-preparation').onclick=()=>{if(result)download('training-preparation.json',result);};
$('export-document').onclick=()=>{if(result?.report.status==='pass')download('audit-document.json',result.document);};
$('export-training').onclick=()=>{if(result?.report.status==='pass')download('training.jsonl',result.document.samples.map(({id,input_ids,labels,attention_mask})=>JSON.stringify({id,input_ids,labels,attention_mask})).join('\n')+'\n','application/x-ndjson');};
$('inspect-prepared').onclick=()=>{if(result?.report.status==='pass')try{sessionStorage.setItem('prepared-audit-document',JSON.stringify(result.document));location.href='audit.html?prepared=1';}catch(error){$('prepare-status').textContent='浏览器无法暂存文档，请下载审计文档后在审计页导入。';}};
async function demo(kind='qwen'){invalidate();const ticket=revision;try{const paths=kind==='reasoning'?['traces/reasoning-rendered.json']:kind==='zephyr'?['traces/zephyr-rendered.json']:kind==='mix'?['traces/mixed-rendered.json']:['traces/raw.json','traces/qwen-rendered.json'];const values=await Promise.all(paths.map(async path=>{const response=await fetch(path);if(!response.ok)throw Error('演示文件加载失败');return response.json();}));if(ticket!==revision)return;if(kind==='qwen')$('raw-input').value=JSON.stringify(values[0],null,2);$('rendered-input').value=JSON.stringify(values.at(-1),null,2);invalidate();$('prepare-status').textContent=kind==='reasoning'?'已加载自定义模板的推理策略演示。':kind==='zephyr'?'已加载 Zephyr 风格第二模板族演示（项目自写 WordLevel，非 Hub 词表）。':kind==='mix'?'已加载多源混合冻结演示（mix-traces seed=7，2 行）。':'已加载 Qwen 原生模板的真实分词演示。';}catch(error){if(ticket===revision)$('prepare-status').textContent=error.message;}}
$('load-demo').onclick=()=>demo('qwen');$('load-reasoning').onclick=()=>demo('reasoning');$('load-zephyr').onclick=()=>demo('zephyr');$('load-mix').onclick=()=>demo('mix');
async function lengthDemo(mode){
  if(!$('rendered-input').value.trim()){$('prepare-status').textContent='请先加载分词结果（如完整演示）。';return;}
  if(mode==='right'){$('max-length').value='192';$('overflow').value='truncate-right';}
  else{$('max-length').value='200';$('overflow').value='truncate-complete-turns';}
  invalidate();
  $('prepare-status').textContent=mode==='right'?'已套用右截断 192，正在生成…':'已套用完整轮次截断 max=200，正在生成…';
  await run('prepare');
}
$('demo-truncate-right').onclick=()=>lengthDemo('right');
$('demo-complete-turns').onclick=()=>lengthDemo('turns');
try{await loadPresets();}catch(error){$('prepare-status').textContent=error.message;}
await demo();
