"""Executable comparison against public Teich prepare_data/mask_data APIs.

Shared formatter metadata; separate MoonBit and Teich label implementations.
The comparison proves label compatibility within the recorded contracts only.
"""
import argparse
import copy
import hashlib
import json
import platform
import subprocess
from pathlib import Path
from types import SimpleNamespace
from importlib.metadata import version
from render import load_backend, load_tokenizer, rendered_rows, TEICH_REVISION

ROOT = Path(__file__).resolve().parents[2]


def engine(op, value, policy=None):
    bridge = ROOT / 'integrations/teich/bridge.mjs'
    result = subprocess.run(['node', str(bridge)], input=json.dumps(dict(op=op,value=value,policy=policy),ensure_ascii=False),
                            text=True,encoding='utf-8',capture_output=True,check=True,cwd=ROOT)
    parsed = json.loads(result.stdout)
    if not parsed.get('ok'):
        raise ValueError(parsed.get('error'))
    return parsed


def authored_tokenizer(directory):
    """Real HF WordLevel tokenizer; project-authored template, no model claim."""
    from tokenizers import Tokenizer, Regex, models, pre_tokenizers
    directory.mkdir(parents=True,exist_ok=True)
    template = (
        "{% for message in messages %}{{ '<|im_start|>' + message.role + '\\n' }}"
        "{% if message.reasoning_content %}{{ '<think>' + message.reasoning_content + '</think>' }}{% endif %}"
        "{{ message.content or '' }}"
        "{% for call in message.tool_calls or [] %}{{ '<tool_call>' }}{{ call.function | tojson }}{{ '</tool_call>' }}{% endfor %}"
        "{{ '<|im_end|>\\n' }}{% endfor %}"
    )
    chars = sorted(set(chr(i) for i in range(32,127)) | set('\n请用中文回答二加等于四。🌓推理过程'))
    specials = ['<unk>','<pad>','<|im_start|>','<|im_end|>']
    tok = Tokenizer(models.WordLevel({c:i for i,c in enumerate(specials+chars)},unk_token='<unk>'))
    tok.pre_tokenizer = pre_tokenizers.Split(Regex(r'[\s\S]'),behavior='isolated')
    tok.add_special_tokens(specials)
    tok.save(str(directory / 'tokenizer.json'))
    (directory / 'tokenizer_config.json').write_text(json.dumps(dict(chat_template=template,eos_token='<|im_end|>',pad_token='<pad>',unk_token='<unk>'),ensure_ascii=False,indent=2)+'\n',encoding='utf-8')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--teich-source')
    parser.add_argument('--qwen', default=str(ROOT / '.local/sft-data'))
    parser.add_argument('--out', default=str(ROOT / 'artifacts/teich-validation'))
    parser.add_argument('--refresh-fixtures',action='store_true')
    args = parser.parse_args()
    Dataset, prepare_data, cls = load_backend(args.teich_source)
    from teich import mask_data
    out = Path(args.out);out.mkdir(parents=True,exist_ok=True)
    tiny = out / 'authored-tokenizer';authored_tokenizer(tiny)
    original = json.loads((ROOT / 'examples/traces/raw.json').read_text(encoding='utf-8'))
    default = json.loads((ROOT / 'examples/traces/assistant-all.json').read_text())
    policies = dict(assistant_all=default,
                    final_only={**default,'train_on_reasoning':False,'train_on_tools':False},
                    tool_only={**default,'train_on_reasoning':False,'train_on_final_answers':False},
                    reasoning_only={**default,'train_on_tools':False,'train_on_final_answers':False},
                    assistant_and_tool_results={**default,'train_on_tool_responses':True},
                    all_roles={key:True for key in default})
    checks = []
    oracle = []
    for backend, directory in [('qwen-native',Path(args.qwen)),('authored-reasoning',tiny)]:
        tok,token_sha,template_sha=load_tokenizer(directory,cls)
        raw=copy.deepcopy(original)
        if backend == 'authored-reasoning':
            raw['rows'].append(dict(id='explicit-reasoning',source='project-authored-apache-2.0:reasoning',messages=[
                dict(role='system',content='Answer carefully.'),dict(role='user',content='What is two plus two?'),
                dict(role='assistant',reasoning_content='Two and two make four. 推理过程 🌓',content='Four.')]))
        normalized=engine('normalize',raw)
        rendered=dict(schema='rendered-traces-utf16-v1', template_family='chatml-typed-v1',tokenizer_source='local-tokenizer-sha256:'+token_sha,
                      template_source='local-chat-template-sha256:'+template_sha,
                      rows=rendered_rows(normalized,tok,Dataset,prepare_data))
        (out / (backend+'-rendered.json')).write_text(json.dumps(rendered,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        if not args.refresh_fixtures:
            fixture='qwen-rendered.json' if backend=='qwen-native' else 'reasoning-rendered.json'
            committed=json.loads((ROOT / 'examples/traces' / fixture).read_text(encoding='utf-8'))
            if rendered != committed:raise AssertionError('Rendered fixture drift: '+fixture)
        if args.refresh_fixtures:
            if backend == 'qwen-native':
                target=ROOT / 'examples/traces/qwen-rendered.json'
                target.write_text(json.dumps(rendered,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
            else:
                target=ROOT / 'examples/traces/reasoning-rendered.json'
                target.write_text(json.dumps(rendered,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        for index, row in enumerate(normalized['rows']):
            prepared=prepare_data(Dataset.from_list([{'messages':row['messages'],'tools':row['tools']}]),
                                  tok,strict=True,tokenize=True,validate_tools=True,verbose=False)
            for policy_name,policy in policies.items():
                # Rows without a selected kind must reject, not silently vanish.
                one={**rendered,'rows':[rendered['rows'][index]]}
                try:
                    moon=engine('prepare',one,policy)
                except ValueError as error:
                    if 'no effective targets' not in str(error):raise
                    moon=None
                trainer=SimpleNamespace(train_dataset=prepared,eval_dataset=None,tokenizer=tok,
                                        args=SimpleNamespace(dataset_text_field='text',max_length=None,packing=False))
                try:
                    ref=mask_data(trainer,tokenizer=tok,audit=False,verbose=False,**policy).train_dataset[0]['labels']
                except ValueError as error:
                    if 'masked' not in str(error).lower():raise
                    ref=None
                if moon is None or ref is None:
                    if moon is not None or ref is not None:raise AssertionError((backend,row['id'],policy_name,'different empty-target handling'))
                    checks.append(dict(backend=backend,id=row['id'],policy=policy_name,result='both-reject-empty-targets'))
                    oracle.append(dict(backend=backend,id=row['id'],policy=policy,reject=True))
                    continue
                labels=moon['document']['samples'][0]['labels']
                if labels != ref:
                    differences=[i for i,(a,b) in enumerate(zip(labels,ref)) if a!=b]
                    raise AssertionError((backend,row['id'],policy_name,'label mismatch',differences[:20]))
                if moon['report']['status'] != 'pass':raise AssertionError(moon['report']['findings'])
                checks.append(dict(backend=backend,id=row['id'],policy=policy_name,result='exact-label-match',
                                   tokens=len(labels),effective_targets=sum(x!=-100 for x in labels[1:])))
                oracle.append(dict(backend=backend,id=row['id'],policy=policy,labels=ref))
        # Simulate a broken trainer collator labeling tool output. This is a
        # fault injection, never described as a bug in Teich.
        prepared=engine('prepare',rendered,default)
        document=copy.deepcopy(prepared['document'])
        sample=document['samples'][1]
        tool_index=next(i for s in sample['spans'] if s['role']=='tool' for i in range(s['start'],s['end']) if i>0)
        sample['labels'][tool_index]=sample['input_ids'][tool_index]
        fault=engine('audit',document)
        assert fault['report']['status']=='fail'
        assert any(f['code']=='UNEXPECTED_TARGET' for f in fault['report']['findings'])
        checks.append(dict(backend=backend,result='injected-tool-target-blocked',index=tool_index))
    summary=dict(schema='teich-cross-validation-v1',teich_revision=TEICH_REVISION,
                 teich_reference='public prepare_data/mask_data APIs',shared_component='Teich rendering/candidate spans',
                 independent_component='MoonBit label assembly versus Teich mask_data',
                 scope='Qwen native text/tool traces; authored reasoning template. No training-quality claim.',
                 environment=dict(python=platform.python_version(),platform=platform.platform(),
                                  datasets=version('datasets'),transformers=version('transformers'),tokenizers=version('tokenizers'),
                                  pandas=version('pandas'),numpy=version('numpy')),
                 raw_sha256=hashlib.sha256((ROOT / 'examples/traces/raw.json').read_bytes()).hexdigest(),checks=checks)
    (out / 'summary.json').write_text(json.dumps(summary,indent=2)+'\n',encoding='utf-8')
    reference=dict(schema='teich-label-reference-v1',teich_revision=TEICH_REVISION,cases=oracle)
    (out / 'label-reference.json').write_text(json.dumps(reference,indent=2)+'\n',encoding='utf-8')
    if args.refresh_fixtures:
        (ROOT / 'examples/traces/teich-label-reference.json').write_text(json.dumps(reference,indent=2)+'\n',encoding='utf-8')
    else:
        if reference != json.loads((ROOT / 'examples/traces/teich-label-reference.json').read_text(encoding='utf-8')):
            raise AssertionError('Live Teich labels differ from committed reference')
    print(json.dumps(dict(checks=len(checks),exact_matches=sum(c['result']=='exact-label-match' for c in checks),
                          empty_rejections=sum(c['result']=='both-reject-empty-targets' for c in checks),out=str(out))))


if __name__=='__main__':main()
