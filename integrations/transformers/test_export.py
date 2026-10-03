import json
import socket
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from export_fixture import ROOT, export_fixture


class ExportTests(unittest.TestCase):
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
