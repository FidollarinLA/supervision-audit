"""Optional native-template adapter. No labels or audit decisions live here.

Teich supplies typed candidate ranges. HF supplies actual tokens and offsets.
Python codepoint positions are converted to the core's UTF-16 contract.
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path

TEICH_REVISION = '609412fcb5649268b6de3f789fc0d59c4dce0585'


def load_backend(source=None):
    if source:
        root = Path(source).resolve()
        formatter = root / 'src/teich/formatter.py'
        if not formatter.is_file():
            raise ValueError('--teich-source must contain src/teich/formatter.py')
        sys.path.insert(0, str(root / 'src'))
    from datasets import Dataset, disable_progress_bars
    from teich import prepare_data
    import teich
    lock = json.loads(Path(__file__).with_name('reference-lock.json').read_text(encoding='utf-8-sig'))
    package = Path(teich.__file__).resolve().parent
    for name, expected in lock['git_blobs'].items():
        content = (package / name).read_bytes()
        actual = hashlib.sha1(b'blob ' + str(len(content)).encode() + b'\0' + content).hexdigest()
        if actual != expected:
            raise ValueError('Teich reference source differs from pinned revision: '+name)
    from transformers import PreTrainedTokenizerFast
    disable_progress_bars()
    return Dataset, prepare_data, PreTrainedTokenizerFast


def load_tokenizer(directory, cls):
    root = Path(directory).resolve()
    config_bytes = (root / 'tokenizer_config.json').read_bytes()
    config = json.loads(config_bytes)
    token_bytes = (root / 'tokenizer.json').read_bytes()
    if not isinstance(config.get('chat_template'), str):
        raise ValueError('Local tokenizer must declare a single text chat_template')
    tok = cls(tokenizer_file=str(root / 'tokenizer.json'), chat_template=config['chat_template'])
    for name in ['bos_token', 'eos_token', 'unk_token', 'pad_token']:
        value = config.get(name)
        if isinstance(value, dict):
            value = value.get('content')
        if isinstance(value, str):
            setattr(tok, name, value)
    return tok, hashlib.sha256(token_bytes).hexdigest(), hashlib.sha256(config['chat_template'].encode()).hexdigest()


def rendered_rows(normalized, tok, Dataset, prepare_data):
    output = []
    for raw in normalized['rows']:
        # Dataset JSON features canonicalize object keys. Use the same semantic
        # object ordering for the independent native-template equality check.
        raw = json.loads(json.dumps(raw,sort_keys=True,ensure_ascii=False))
        # Per row avoids Arrow coercing absent optional fields into nulls.
        dataset = Dataset.from_list([{'messages': raw['messages'], 'tools': raw['tools']}])
        prepared = prepare_data(dataset, tok, strict=True, tokenize=True,
                                validate_tools=True, verbose=False)
        if len(prepared) != 1:
            raise ValueError('Native template discarded a row; preparation rejects silent drops')
        row = prepared[0]
        text = row['text']
        native = tok.apply_chat_template(raw['messages'], tools=raw['tools'] or None,
                                        tokenize=False, add_generation_prompt=False)
        if text != native:
            raise ValueError('Prepared text differs from target native template')
        spans = row['teich_supervised_spans']
        # A model template may omit a supplied reasoning field. Make this
        # unsupported layout explicit instead of training an incomplete trace.
        reasoning_count = sum(bool(m.get('reasoning_content')) for m in raw['messages'])
        if sum(s.get('kind') == 'reasoning' for s in spans) < reasoning_count:
            raise ValueError('Selected template omits explicit reasoning; choose a compatible template')
        encoded = tok(text, add_special_tokens=False, return_offsets_mapping=True)
        if encoded['input_ids'] != row['input_ids']:
            raise ValueError('Prepared and offset-tokenized input_ids differ')
        positions = [0]
        for char in text:
            positions.append(positions[-1] + len(char.encode('utf-16-le')) // 2)
        candidates = []
        for span in spans:
            candidates.append({key: positions[span[key]] for key in ['start','end','source_start','source_end']} |
                              {'kind':span['kind'], 'role':span['role']})
        output.append(dict(id=raw['id'], source=raw['source'], text=text,
                           input_ids=encoded['input_ids'], attention_mask=encoded['attention_mask'],
                           offsets=[dict(start=positions[a],end=positions[b]) for a,b in encoded['offset_mapping']],
                           candidates=candidates))
    return output


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--tokenizer', required=True)
    parser.add_argument('--teich-source')
    args = parser.parse_args()
    Dataset, prepare_data, cls = load_backend(args.teich_source)
    tok, token_sha, template_sha = load_tokenizer(args.tokenizer, cls)
    normalized = json.load(sys.stdin)
    if normalized.get('schema') != 'normalized-traces-v1':
        raise ValueError('Expected MoonBit normalized-traces-v1 output')
    result = dict(schema='rendered-traces-utf16-v1', template_family='chatml-typed-v1', tokenizer_source='local-tokenizer-sha256:'+token_sha,
                  template_source='local-chat-template-sha256:'+template_sha,
                  rows=rendered_rows(normalized,tok,Dataset,prepare_data))
    print(json.dumps(result,ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(str(error),file=sys.stderr)
        sys.exit(2)
