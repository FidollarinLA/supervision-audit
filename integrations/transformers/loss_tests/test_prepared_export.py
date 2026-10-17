"""Exercise the actual JSONL exporter with an offline random GPT-2 reference.

Token IDs are bijectively remapped to a small vocabulary to test the loss mask,
not Qwen embeddings, training quality or the tokenizer's semantic correctness.
"""
import copy
import json
import math
import socket
import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

import torch
from transformers import GPT2Config, GPT2LMHeadModel

ROOT = Path(__file__).resolve().parents[3]


def prepare(emit, bounded=False):
    command = ["node", "prepare.mjs", "examples/traces/qwen-rendered.json",
               "--rendered", "--emit", emit]
    if bounded:
        command += ["--max-length", "192", "--overflow", "truncate-right"]
    result = subprocess.run(command, cwd=ROOT, text=True, encoding="utf-8", capture_output=True,
                            check=True, timeout=30)
    if emit == "jsonl":
        return [json.loads(line) for line in result.stdout.splitlines()]
    return json.loads(result.stdout)


def audit(document):
    script = """
import {readFileSync} from 'node:fs';
import {audit_json} from './web/preparation-engine.js';
process.stdout.write(audit_json(readFileSync(0,'utf8')));
"""
    result = subprocess.run(["node", "--input-type=module", "-e", script],
                            input=json.dumps(document), cwd=ROOT, text=True, encoding="utf-8",
                            capture_output=True, check=True, timeout=30)
    return json.loads(result.stdout)["report"]


def collate(rows):
    # Remapping changes token identity, never label position or ignore status.
    vocabulary = sorted({token for row in rows for token in row["input_ids"]})
    mapping = {token: index + 1 for index, token in enumerate(vocabulary)}
    width = max(len(row["input_ids"]) for row in rows)
    batch = {key: [] for key in ("input_ids", "labels", "attention_mask")}
    for row in rows:
        padding = width - len(row["input_ids"])
        batch["input_ids"].append([mapping[t] for t in row["input_ids"]] + [0] * padding)
        batch["labels"].append([mapping[t] if t != -100 else -100 for t in row["labels"]] + [-100] * padding)
        batch["attention_mask"].append(row["attention_mask"] + [0] * padding)
    return {key: torch.tensor(value, dtype=torch.long) for key, value in batch.items()}, len(mapping) + 1


class PreparedExportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        torch.set_num_threads(1)

    def setUp(self):
        for name in ("connect", "connect_ex"):
            guard = patch.object(socket.socket, name, side_effect=AssertionError("Network forbidden"))
            guard.start()
            self.addCleanup(guard.stop)

    def test_exported_labels_match_actual_shifted_loss_and_logit_gradients(self):
        for bounded, count in ((False, 45), (True, 33)):
            with self.subTest(bounded=bounded):
                prepared = prepare("result", bounded)
                rows = prepare("jsonl", bounded)
                self.assertEqual(prepared["report"]["status"], "pass")
                self.assertEqual(prepared["report"]["effective_target_count"], count)
                self.assertEqual(rows, [{key: sample[key] for key in ("id", "input_ids", "labels", "attention_mask")}
                                        for sample in prepared["document"]["samples"]])
                batch, vocabulary = collate(rows)
                torch.manual_seed(20261018)
                width = batch["input_ids"].shape[1]
                model = GPT2LMHeadModel(GPT2Config(
                    vocab_size=vocabulary, n_positions=width, n_ctx=width,
                    n_embd=8, n_layer=1, n_head=1, resid_pdrop=0,
                    embd_pdrop=0, attn_pdrop=0, use_cache=False,
                    pad_token_id=0, bos_token_id=1, eos_token_id=1,
                    attn_implementation="eager")).cpu().eval()
                output = model(**batch)
                terms, expected_positions = [], []
                for scores, labels in zip(output.logits.detach().tolist(), batch["labels"].tolist()):
                    positions = []
                    for t, target in enumerate(labels[1:]):
                        if target == -100:
                            continue
                        maximum = max(scores[t])
                        terms.append(maximum + math.log(sum(math.exp(s - maximum) for s in scores[t])) - scores[t][target])
                        positions.append(t)
                    expected_positions.append(positions)
                self.assertEqual(len(terms), count)
                self.assertAlmostEqual(output.loss.item(), sum(terms) / count, delta=1e-6)
                target_positions = [[i - 1 for i in sample["effective_target_indices"]]
                                    for sample in prepared["report"]["samples"]]
                self.assertEqual(expected_positions, target_positions)
                output.logits.retain_grad()
                output.loss.backward()
                observed = [torch.nonzero(row.abs().sum(dim=-1) > 0).flatten().tolist()
                            for row in output.logits.grad]
                self.assertEqual(observed, target_positions)

    def test_truncation_counts_and_clipped_expectations_survive_downstream_audit(self):
        result = prepare("result", True)
        summary = result["sequence_summary"]
        self.assertEqual((summary["truncated_samples"], summary["removed_tokens"], summary["removed_targets"]), (1, 24, 12))
        self.assertEqual(audit(result["document"]), result["report"])

    def test_collator_overwriting_a_tool_response_is_blocked_before_training(self):
        result = prepare("result")
        broken = copy.deepcopy(result["document"])
        report_row = result["report"]["samples"][1]
        index = next(i for i, role in enumerate(report_row["roles"])
                     if role == "tool" and broken["samples"][1]["attention_mask"][i])
        broken["samples"][1]["labels"][index] = broken["samples"][1]["input_ids"][index]
        report = audit(broken)
        self.assertEqual(report["status"], "fail")
        self.assertTrue(any(f["token_index"] == index and f["sample_id"] == report_row["id"]
                            for f in report["findings"]))


if __name__ == "__main__":
    unittest.main()
