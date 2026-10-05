"""Rebuild the public, synthetic tokenizer/collator integration fixture offline.

This exporter does not audit or repair labels. MoonBit owns audit decisions.
"""
import argparse
import hashlib
import json
from importlib.metadata import version
from pathlib import Path

from tokenizers import Tokenizer
from tokenizers.models import WordLevel
from tokenizers.pre_tokenizers import WhitespaceSplit
from transformers import DataCollatorForLanguageModeling, PreTrainedTokenizerFast

ROOT = Path(__file__).resolve().parents[2]
CORPUS = ROOT / "examples/transformers/corpus.jsonl"
VERSIONS = {"transformers": "4.57.1", "tokenizers": "0.22.1", "numpy": "2.3.4"}


def export_fixture(output_dir, *, max_length=None, truncation_side="right"):
    if max_length is not None and (type(max_length) is not int or not 1 <= max_length <= 128):
        raise ValueError("max_length must be an integer from 1 to 128")
    if truncation_side not in ("left", "right"):
        raise ValueError("truncation_side must be left or right")
    if max_length is None and truncation_side != "right":
        raise ValueError("truncation_side requires max_length")
    for package, expected in VERSIONS.items():
        if version(package) != expected:
            raise RuntimeError(f"Install requirements.txt: expected {package}=={expected}")
    source = CORPUS.read_bytes()
    records = [json.loads(line) for line in source.decode("utf-8").splitlines() if line]
    # Fixed local corpus and a deterministic vocabulary; no from_pretrained/network.
    vocabulary = {"[PAD]": 0, "[UNK]": 1}
    words = sorted({word for record in records for word in record["text"].split()})
    vocabulary.update({word: index + 2 for index, word in enumerate(words)})
    backend = Tokenizer(WordLevel(vocab=vocabulary, unk_token="[UNK]"))
    backend.pre_tokenizer = WhitespaceSplit()
    tokenizer = PreTrainedTokenizerFast(
        tokenizer_object=backend, unk_token="[UNK]", pad_token="[PAD]",
        padding_side="right", model_max_length=128,
        truncation_side=truncation_side,
    )
    original = [tokenizer(record["text"], add_special_tokens=False,
                          return_special_tokens_mask=True) for record in records]
    encoded = original if max_length is None else [
        tokenizer(record["text"], add_special_tokens=False,
                  return_special_tokens_mask=True, truncation=True, max_length=max_length)
        for record in records
    ]
    collator = DataCollatorForLanguageModeling(
        tokenizer=tokenizer, mlm=False, pad_to_multiple_of=8, return_tensors="np",
    )
    batch = collator(encoded)
    original_batch = collator(original) if max_length is not None else None
    retained_ranges = []
    rows = []
    for index, record in enumerate(records):
        # Preserve every collator-produced ID, label and attention value unchanged.
        row = {key: batch[key][index].tolist()
               for key in ("input_ids", "labels", "attention_mask")}
        length = len(encoded[index]["input_ids"])
        padded_length = len(row["input_ids"])
        if original_batch is not None:
            original_length = len(original[index]["input_ids"])
            start = original_length - length if truncation_side == "left" else 0
            end = start + length
            if encoded[index]["input_ids"] != original[index]["input_ids"][start:end]:
                raise RuntimeError("Tokenizer output is not the expected contiguous source range")
            row["original_supervised_tokens"] = int((original_batch["labels"][index] != -100).sum())
            retained_ranges.append({"id": record["id"], "original_tokens": original_length,
                                    "retained_token_range": [start, end]})
        row.update(id=record["id"],
                   spans=[{"start": 0, "end": padded_length, "role": "text"}],
                   segments=[{"start": 0, "end": length, "source_id": record["id"]}])
        if length < padded_length:
            row["segments"].append({"start": length, "end": padded_length,
                                    "source_id": "generated:padding:" + record["id"]})
        rows.append(row)
    manifest = {
        "fixture_schema": "transformers-collator-fixture-v1",
        "packages": VERSIONS,
        "corpus_sha256": hashlib.sha256(source).hexdigest(),
        "corpus_origin": "Repository-authored synthetic text; Apache-2.0",
        "tokenizer": "WordLevel + WhitespaceSplit; local vocabulary; no special tokens added",
        "vocabulary": vocabulary,
        "collator": {"mlm": False, "pad_to_multiple_of": 8, "return_tensors": "np",
                     "padding_side": "right", "pad_token_id": 0},
        "label_transformations": [],
        "metadata": "text role declared for the row; generated padding has its own source segment",
    }
    if max_length is not None:
        manifest["truncation"] = {
            "max_length": max_length, "side": truncation_side,
            "source_ranges": retained_ranges,
            "baseline": "Non-ignored labels from the same collator without truncation; includes first labels",
            "coordinates": "Half-open original token indices; row spans/segments are rebased to the retained sequence",
        }
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "batch.jsonl").write_text(
        "".join(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n" for row in rows),
        encoding="utf-8",
    )
    (output_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8",
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--max-length", type=int)
    parser.add_argument("--truncation-side", choices=("left", "right"), default="right")
    args = parser.parse_args()
    export_fixture(args.output_dir, max_length=args.max_length, truncation_side=args.truncation_side)
