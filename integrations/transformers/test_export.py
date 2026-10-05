import json
import socket
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from export_fixture import ROOT, export_fixture


class ExportTests(unittest.TestCase):
    def test_truncation_rebuilds_both_sides_and_rebases_source_ranges(self):
        for side, first_ids, interval in (("right", [3, 5, 12, 6], [0, 4]),
                                          ("left", [4, 11, 8, 10], [4, 8])):
            with self.subTest(side=side), tempfile.TemporaryDirectory() as directory, \
                 patch.object(socket.socket, "connect", side_effect=AssertionError("Network forbidden")), \
                 patch.object(socket.socket, "connect_ex", side_effect=AssertionError("Network forbidden")):
                export_fixture(directory, max_length=4, truncation_side=side)
                for name in ("batch.jsonl", "manifest.json"):
                    self.assertEqual((Path(directory) / name).read_bytes(),
                                     (ROOT / "examples/transformers" / ("truncate-" + side) / name).read_bytes())
                rows = [json.loads(line) for line in (Path(directory) / "batch.jsonl").read_text().splitlines()]
                self.assertEqual(rows[0]["input_ids"], first_ids + [0] * 4)
                self.assertEqual(rows[0]["labels"], first_ids + [-100] * 4)
                self.assertEqual([r["original_supervised_tokens"] for r in rows], [8, 4, 1])
                self.assertEqual([sum(r["attention_mask"]) for r in rows], [4, 4, 1])
                self.assertEqual(rows[0]["segments"], [
                    {"start": 0, "end": 4, "source_id": "text-long"},
                    {"start": 4, "end": 8, "source_id": "generated:padding:text-long"}])
                manifest = json.loads((Path(directory) / "manifest.json").read_text())
                self.assertEqual(manifest["truncation"]["source_ranges"][0]["retained_token_range"], interval)

    def test_truncation_edges_and_invalid_options(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "invalid"
            for options in ({"max_length": 0}, {"max_length": -1}, {"max_length": 129},
                            {"max_length": True}, {"max_length": 1.5},
                            {"max_length": 4, "truncation_side": "middle"}, {"truncation_side": "left"}):
                with self.subTest(options=options), self.assertRaises(ValueError):
                    export_fixture(output, **options)
                self.assertFalse(output.exists())
            for limit, counts in ((1, [1, 1, 1]), (128, [8, 4, 1])):
                export_fixture(directory, max_length=limit)
                rows = [json.loads(line) for line in (Path(directory) / "batch.jsonl").read_text().splitlines()]
                self.assertEqual([sum(r["attention_mask"]) for r in rows], counts)

    def test_offline_regeneration_matches_committed_fixture(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(socket.socket, "connect", side_effect=AssertionError("Network forbidden")), \
                 patch.object(socket.socket, "connect_ex", side_effect=AssertionError("Network forbidden")):
                export_fixture(directory)
            for name in ("batch.jsonl", "manifest.json"):
                self.assertEqual((Path(directory) / name).read_bytes(),
                                 (ROOT / "examples/transformers" / name).read_bytes())
            rows = [json.loads(line) for line in (Path(directory) / "batch.jsonl").read_text().splitlines()]
            self.assertEqual([sum(row["attention_mask"]) for row in rows], [8, 4, 1])
            self.assertEqual([len(row["labels"]) for row in rows], [8, 8, 8])

    def test_wrong_dependency_version_fails_before_output(self):
        with tempfile.TemporaryDirectory() as directory, patch("export_fixture.version", return_value="0.0"):
            output = Path(directory) / "new"
            with self.assertRaisesRegex(RuntimeError, "expected transformers==4.57.1"):
                export_fixture(output)
            self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
