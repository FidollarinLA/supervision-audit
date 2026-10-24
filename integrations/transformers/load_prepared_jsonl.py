#!/usr/bin/env python3
"""Load SupervisionAudit gated training JSONL into a Hugging Face Dataset.

The JSONL rows are already tokenized unshifted labels from MoonBit preparation.
This helper does not render chat templates, call Teich, or train a model.
It only validates the local contract and exposes a trainer-friendly Dataset.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


REQUIRED = ("id", "input_ids", "labels", "attention_mask")


def load_rows(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line_no, line in enumerate(handle, start=1):
            text = line.strip()
            if not text:
                continue
            row = json.loads(text)
            for key in REQUIRED:
                if key not in row:
                    raise ValueError(f"{path}:{line_no} missing {key}")
            n = len(row["input_ids"])
            if n < 2 or n != len(row["labels"]) or n != len(row["attention_mask"]):
                raise ValueError(f"{path}:{line_no} arrays must be equal length >= 2")
            if any(label != -100 and label != token for label, token in zip(row["labels"], row["input_ids"])):
                raise ValueError(
                    f"{path}:{line_no} labels must equal input_ids or -100 (causal-lm-unshifted-v1)"
                )
            if any(mask not in (0, 1) for mask in row["attention_mask"]):
                raise ValueError(f"{path}:{line_no} attention_mask must be 0/1")
            if not any(label != -100 for label in row["labels"][1:]):
                raise ValueError(f"{path}:{line_no} has no effective shifted targets")
            rows.append(
                {
                    "id": row["id"],
                    "input_ids": list(row["input_ids"]),
                    "labels": list(row["labels"]),
                    "attention_mask": list(row["attention_mask"]),
                }
            )
    if not rows:
        raise ValueError(f"{path} contains no training rows")
    return rows


def to_dataset(rows: list[dict[str, Any]]):
    try:
        from datasets import Dataset
    except ImportError as exc:  # pragma: no cover - optional dependency
        raise SystemExit(
            "Install Hugging Face datasets to build a Dataset object, "
            "or use --emit json to inspect validated rows without datasets."
        ) from exc
    return Dataset.from_list(rows)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("jsonl", type=Path, help="Gated training JSONL from prepare.mjs --emit jsonl")
    parser.add_argument(
        "--emit",
        choices=("summary", "json", "dataset-info"),
        default="summary",
        help="summary counts, json dump, or Dataset info when datasets is installed",
    )
    args = parser.parse_args()
    rows = load_rows(args.jsonl)
    targets = sum(1 for row in rows for label in row["labels"][1:] if label != -100)
    if args.emit == "json":
        print(json.dumps({"rows": rows, "effective_targets": targets}, ensure_ascii=False, indent=2))
        return
    if args.emit == "dataset-info":
        dataset = to_dataset(rows)
        print(dataset)
        print(f"features={dataset.features}")
        return
    print(
        f"loaded {len(rows)} rows; {targets} effective targets; "
        "ready for SFTTrainer with packing=False and no extra response masking"
    )


if __name__ == "__main__":
    main()
