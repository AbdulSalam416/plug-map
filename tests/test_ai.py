"""AI step tests. They use a fake model, so no API key or network is needed."""
import json
import os
import re
import shutil
import tempfile
import unittest
from unittest import mock

import yaml

from plugmap import ai
from plugmap.vocab import Vocabulary, pack_names

README = os.path.join(os.path.dirname(__file__), "fixtures", "sample_repo")


class ParsingTest(unittest.TestCase):
    def test_parse_terms_handles_code_fences(self):
        text = '```json\n{"terms": [{"name": "QBlade", "kind": "ecosystem", "role": "builds-on", "quote": "q"}]}\n```'
        self.assertEqual(ai.parse_terms(text)[0]["name"], "QBlade")
        self.assertEqual(ai.parse_terms("not json"), [])

    def test_provider_reply_shapes(self):
        anthropic = {"content": [{"type": "text", "text": '{"terms": []}'}]}
        openai = {"output": [{"type": "reasoning"}, {"type": "message",
                  "content": [{"type": "output_text", "text": '{"terms": []}'}]}]}
        self.assertEqual(ai.anthropic_text(anthropic), '{"terms": []}')
        self.assertEqual(ai.openai_text(openai), '{"terms": []}')
        self.assertEqual(ai.openai_text({"output_text": "x"}), "x")

    def test_verify_drops_invented_quotes_and_known_terms(self):
        vocab = Vocabulary(pack_names())
        text = "Couples to QBlade for turbine dynamics. Writes NetCDF files."
        terms = [
            {"name": "QBlade", "kind": "ecosystem", "role": "builds-on", "quote": "Couples to   QBlade"},
            {"name": "HDF-EOS", "kind": "format", "role": "reads", "quote": "reads HDF-EOS granules"},
            {"name": "NetCDF", "kind": "format", "role": "writes", "quote": "Writes NetCDF files."},
        ]
        kept = ai.verify(terms, text, vocab)
        self.assertEqual([k["name"] for k in kept], ["QBlade"])

    def test_verify_drops_quotes_that_only_name_the_term(self):
        vocab = Vocabulary(pack_names())
        text = "Hardware\n\nI2C\n\n* Bluetooth  low energy.\n\nTalks to the inverter over Modbus RTU."
        terms = [{"name": "I2C", "kind": "protocol", "role": "speaks", "quote": "I2C"},
                 {"name": "Bluetooth Low Energy", "kind": "protocol", "role": "speaks", "quote": "Bluetooth  low energy."},
                 {"name": "RTU framing", "kind": "protocol", "role": "speaks", "quote": "Talks to the inverter"}]
        self.assertEqual([k["name"] for k in ai.verify(terms, text, vocab)], ["RTU framing"])

    def test_kind_and_role_are_normalised(self):
        self.assertEqual(ai.kind_and_role({"kind": "protocol", "role": "speaks"}), ("protocol", "speaks"))
        self.assertEqual(ai.kind_and_role({"kind": "format", "role": "builds on"}), ("format", "builds-on"))
        # the kind put in the role field, as the pilot run did
        self.assertEqual(ai.kind_and_role({"role": "data-source"}), ("source", "uses"))
        self.assertEqual(ai.kind_and_role({"kind": "", "role": "Protocol"}), ("protocol", "uses"))
        # unknown kinds are left for the reviewer rather than guessed
        self.assertEqual(ai.kind_and_role({"kind": "thing", "role": "reads"}), (None, "reads"))


class ProposeTest(unittest.TestCase):
    """Run propose() end to end against temporary data and a fake model."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        os.makedirs(os.path.join(self.tmp, "tools"))
        os.makedirs(os.path.join(self.tmp, "claims"))
        self.repo = os.path.join(self.tmp, "repo")
        shutil.copytree(README, self.repo)
        with open(os.path.join(self.repo, "README.md"), "a", encoding="utf-8") as f:
            f.write("\nTurbine loads are coupled through QBlade input decks. " + "Padding text. " * 30)
        url = "https://github.com/example/sample-solar"
        with open(os.path.join(self.tmp, "tools", "renewable-energy.json"), "w") as f:
            json.dump([{"name": "sample-solar", "repo": url, "read": True, "stars": 1}], f)
        open(os.path.join(self.tmp, "claims", "renewable-energy.jsonl"), "w").close()
        self.proposals = os.path.join(self.tmp, "proposals.yml")
        self.patches = [mock.patch.object(ai, "TOOLS_DIR", os.path.join(self.tmp, "tools")),
                        mock.patch.object(ai, "PROPOSALS", self.proposals),
                        mock.patch.object(ai, "repo_dir", lambda u: self.repo)]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        shutil.rmtree(self.tmp)

    def test_proposals_are_written_and_untrusted_text_is_fenced(self):
        seen = {}

        def fake(system, user):
            seen["system"], seen["user"] = system, user
            return json.dumps({"terms": [
                {"name": "QBlade", "kind": "ecosystem", "role": "builds-on",
                 "quote": "coupled through QBlade input decks"},
                {"name": "Made Up Format", "kind": "format", "role": "reads", "quote": "not in the readme"}]})

        added = ai.propose("Renewable Energy", limit=5, provider="openai", model="test-model",
                           complete=fake, log=lambda *a: None)
        self.assertEqual(added, 1)
        with open(self.proposals, encoding="utf-8") as f:
            data = yaml.safe_load(f)["proposals"]
        self.assertEqual(data[0]["name"], "QBlade")
        self.assertEqual(data[0]["status"], "open")
        self.assertEqual(data[0]["proposed_by"], "openai:test-model")
        fences = re.findall(r"^README-[0-9a-f]{12}$", seen["user"], re.M)
        self.assertEqual(len(fences), 2, "README must sit between two identical random fence lines")
        self.assertEqual(fences[0], fences[1])
        self.assertTrue(seen["user"].rstrip().endswith(fences[0]))
        self.assertIn("untrusted", seen["system"])

    def test_missing_key_gives_a_clear_message(self):
        with mock.patch.dict(os.environ, {"OPENAI_API_KEY": ""}), mock.patch.object(ai, "load_dotenv"):
            with self.assertRaises(SystemExit) as cm:
                ai.propose("Renewable Energy", provider="openai")
        self.assertIn("OPENAI_API_KEY", str(cm.exception))


if __name__ == "__main__":
    unittest.main()
