"""Compare a real tiny GPT-2 forward/backward pass with an independent loss oracle.

All audit decisions are made by the compiled MoonBit engine through Node. Python
only constructs reference experiments and checks their observed correspondence.
"""
import copy
import json
import math
import socket
import subprocess
import unittest
from importlib.metadata import version
from pathlib import Path
from unittest.mock import patch

import torch
from transformers import GPT2Config, GPT2LMHeadModel

ROOT = Path(__file__).resolve().parents[3]
AUDIT_SCRIPT = """
import {readFileSync} from 'node:fs';
import {audit_json} from './web/engine.js';
process.stdout.write(audit_json(readFileSync(0, 'utf8')));
"""


def load_document(name):
    return json.loads((ROOT / "examples" / (name + ".json")).read_text())


def collator_document():
    rows = [json.loads(line) for line in
            (ROOT / "examples/transformers/batch.jsonl").read_text().splitlines()]
    return {"contract": "causal-lm-unshifted-v1", "allowed_roles": ["text"], "samples": rows}


def audit(document):
    process = subprocess.run(["node", "--input-type=module", "-e", AUDIT_SCRIPT],
                             input=json.dumps(document), text=True, cwd=ROOT,
                             capture_output=True, check=True, timeout=30)
    result = json.loads(process.stdout)
    if not result["ok"]:
        raise AssertionError(result)
    return result["report"]


def independent_loss(logits, labels):
    # Plain Python log-sum-exp, no Transformers/PyTorch loss or shift helper.
    # Logit position t predicts the declared target at position t+1.
    terms = []
    positions = []
    for row_index, (row_logits, row_labels) in enumerate(zip(logits.tolist(), labels.tolist())):
        active = []
        for position in range(len(row_labels) - 1):
            target = row_labels[position + 1]
            if target == -100:
                continue
            scores = row_logits[position]
            maximum = max(scores)
            terms.append(maximum + math.log(sum(math.exp(score - maximum) for score in scores)) - scores[target])
            active.append(position)
        positions.append(active)
    return (sum(terms) / len(terms) if terms else math.nan), positions


def tiny_model(document):
    torch.manual_seed(20261004)
    vocab_size = max(max(row["input_ids"]) for row in document["samples"]) + 2
    width = max(len(row["input_ids"]) for row in document["samples"])
    config = GPT2Config(vocab_size=vocab_size, n_positions=width, n_ctx=width,
                        n_embd=16, n_layer=1, n_head=2, resid_pdrop=0,
                        embd_pdrop=0, attn_pdrop=0, use_cache=False,
                        bos_token_id=1, eos_token_id=1, pad_token_id=0,
                        attn_implementation="eager")
    return GPT2LMHeadModel(config).cpu().eval()


def forward(model, document):
    batch = {key: torch.tensor([row[key] for row in document["samples"]], dtype=torch.long)
             for key in ("input_ids", "labels", "attention_mask")}
    model.zero_grad(set_to_none=True)
    output = model(**batch)
    return output, batch["labels"]


class ModelLossTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        for package, expected in {"transformers": "4.57.1", "torch": "2.10.0"}.items():
            if version(package).split("+")[0] != expected:
                raise RuntimeError(f"Install requirements-loss.txt: expected {package}=={expected}")
        torch.set_num_threads(1)

    def setUp(self):
        for method in ("connect", "connect_ex"):
            guard = patch.object(socket.socket, method, side_effect=AssertionError("Network forbidden"))
            guard.start()
            self.addCleanup(guard.stop)

    def assert_loss_and_gradients(self, output, labels, expected_positions):
        reference, positions = independent_loss(output.logits.detach(), labels)
        self.assertEqual(positions, expected_positions)
        self.assertTrue(math.isfinite(reference))
        self.assertAlmostEqual(output.loss.item(), reference, delta=1e-6)
        output.logits.retain_grad()
        output.loss.backward()
        observed = [torch.nonzero(row.abs().sum(dim=-1) > 0).flatten().tolist()
                    for row in output.logits.grad]
        self.assertEqual(observed, expected_positions)

    def test_collator_counts_vs_actual_model_loss_mask(self):
        document = collator_document()
        report = audit(document)
        self.assertEqual(report["status"], "review")
        self.assertEqual(report["supervised_tokens"], 13)
        self.assertEqual(report["error_count"], 0)
        self.assertEqual([f["code"] for f in report["findings"]], ["FIRST_TOKEN_NOT_PREDICTED"] * 3)
        output, labels = forward(tiny_model(document), document)
        self.assert_loss_and_gradients(output, labels, [list(range(7)), [0, 1, 2], []])

    def test_first_label_changes_declared_counts_but_not_model_loss(self):
        document = collator_document()
        model = tiny_model(document)
        original, _ = forward(model, document)
        masked = copy.deepcopy(document)
        for row in masked["samples"]:
            row["labels"][0] = -100
        revised, labels = forward(model, masked)
        self.assertEqual(original.loss.item(), revised.loss.item())
        self.assertEqual(audit(masked)["supervised_tokens"], 10)
        self.assert_loss_and_gradients(revised, labels, [list(range(7)), [0, 1, 2], []])

    def test_assistant_targets_include_the_preceding_user_logit(self):
        document = load_document("healthy")
        self.assertEqual(audit(document)["status"], "pass")
        output, labels = forward(tiny_model(document), document)
        self.assert_loss_and_gradients(output, labels, [[3, 4, 5]])

    def test_packed_boundary_and_padding_targets_do_not_contribute(self):
        document = load_document("pretraining")
        self.assertEqual(audit(document)["status"], "pass")
        output, labels = forward(tiny_model(document), document)
        self.assert_loss_and_gradients(output, labels, [[0, 1, 3, 4]])

    def test_attention_mask_alone_does_not_remove_a_corrupted_padding_label(self):
        document = collator_document()
        document["samples"][1]["labels"][4] = 0
        self.assertEqual(document["samples"][1]["attention_mask"][4], 0)
        report = audit(document)
        self.assertEqual(report["status"], "fail")
        self.assertTrue(any(f["code"] == "PADDING_SUPERVISED" and f["sample_id"] == "text-short"
                            and f["token_index"] == 4 for f in report["findings"]))
        output, labels = forward(tiny_model(document), document)
        self.assert_loss_and_gradients(output, labels, [list(range(7)), [0, 1, 2, 3], []])

    def test_only_first_label_has_no_loss_targets_and_mean_is_undefined(self):
        document = collator_document()
        document["samples"] = [document["samples"][2]]
        report = audit(document)
        self.assertEqual(report["status"], "review")
        self.assertEqual(report["supervised_tokens"], 1)
        output, labels = forward(tiny_model(document), document)
        reference, positions = independent_loss(output.logits.detach(), labels)
        self.assertEqual(positions, [[]])
        self.assertTrue(math.isnan(reference))
        self.assertTrue(torch.isnan(output.loss).item())


if __name__ == "__main__":
    unittest.main()
