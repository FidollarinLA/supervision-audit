"""Fetch checksum-pinned Qwen tokenizer/template only, without corpus or weights."""
import hashlib
from pathlib import Path
import urllib.request

ROOT=Path(__file__).resolve().parents[2]
REVISION='c89bee90d9f811437d9735454613c35b4a3c4dc8'
FILES={
    'tokenizer.json':'c0382117ea329cdf097041132f6d735924b697924d6f6fc3945713e96ce87539',
    'tokenizer_config.json':'5b5d4f65d0acd3b2d56a35b56d374a36cbc1c8fa5cf3b3febbbfabf22f359583',
}
for name,digest in FILES.items():
    target=ROOT / '.local/sft-data' / name
    target.parent.mkdir(parents=True,exist_ok=True)
    if not target.exists():
        temporary=target.with_suffix('.part')
        url=f'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct/resolve/{REVISION}/{name}'
        with urllib.request.urlopen(url,timeout=120) as response,temporary.open('wb') as out:
            while block:=response.read(1<<20):out.write(block)
        if hashlib.sha256(temporary.read_bytes()).hexdigest()!=digest:raise ValueError('Tokenizer checksum mismatch: '+name)
        temporary.replace(target)
    if hashlib.sha256(target.read_bytes()).hexdigest()!=digest:raise ValueError('Tokenizer checksum mismatch: '+name)
print('Verified pinned Qwen tokenizer/template; no corpus or model weights.')
