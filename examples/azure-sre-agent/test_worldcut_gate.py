from __future__ import annotations

import json
import unittest
from pathlib import Path

from worldcut_gate import main

EXAMPLES = Path(__file__).parents[1]


class WorldCutGateTests(unittest.TestCase):
    def test_satisfied_input_returns_exact_versions(self) -> None:
        source = (EXAMPLES / "coherent-deployment.json").read_text(encoding="utf-8")

        result = main(source, "head")

        self.assertTrue(result["allowed"])
        self.assertEqual(result["contractVerdict"], "CONTRACT_SATISFIED")
        self.assertEqual(result["targetRole"], "head")
        self.assertEqual(result["verifiedVersion"], "commit-B")
        self.assertRegex(result["verificationRecordDigest"], r"^[0-9a-f]{64}$")

    def test_violated_input_exposes_no_authorized_versions(self) -> None:
        source = (EXAMPLES / "git-ci-mismatch.json").read_text(encoding="utf-8")

        result = main(source, "head")

        self.assertFalse(result["allowed"])
        self.assertEqual(result["contractVerdict"], "CONTRACT_VIOLATED")
        self.assertIsNone(result["verifiedVersion"])

    def test_invalid_input_fails_closed(self) -> None:
        result = main(json.dumps({"protocolVersion": "0.1"}), "head")

        self.assertFalse(result["allowed"])
        self.assertEqual(result["error"]["code"], "WORLDCUT_INVALID_INPUT")

    def test_missing_target_role_fails_closed(self) -> None:
        source = (EXAMPLES / "coherent-deployment.json").read_text(encoding="utf-8")

        result = main(source, "missing")

        self.assertFalse(result["allowed"])
        self.assertEqual(
            result["error"]["code"],
            "WORLDCUT_TARGET_ROLE_UNBOUND",
        )

    def test_unrelated_satisfied_requirement_does_not_authorize_target(self) -> None:
        document = json.loads(
            (EXAMPLES / "coherent-deployment.json").read_text(encoding="utf-8")
        )
        document["contract"]["requirements"] = [
            {
                "id": "ci-status-only",
                "type": "value_equals",
                "description": "CI passed",
                "role": "ci",
                "path": ["status"],
                "expected": "passed",
            }
        ]
        for observation in document["observations"]:
            if observation["role"] == "head":
                observation["witness"]["version"] = "commit-EVIL"

        result = main(json.dumps(document), "head")

        self.assertFalse(result["allowed"])
        self.assertEqual(
            result["error"]["code"],
            "WORLDCUT_TARGET_ROLE_UNBOUND",
        )
        self.assertEqual(result["contractVerdict"], "CONTRACT_SATISFIED")
        self.assertIsNone(result["verifiedVersion"])

    def test_empty_target_role_is_invalid(self) -> None:
        result = main("{}", "")

        self.assertFalse(result["allowed"])
        self.assertEqual(result["error"]["code"], "WORLDCUT_INVALID_ARGUMENT")

    def test_non_string_input_is_invalid(self) -> None:
        result = main(None, "head")  # type: ignore[arg-type]

        self.assertFalse(result["allowed"])
        self.assertEqual(result["error"]["code"], "WORLDCUT_INVALID_ARGUMENT")


if __name__ == "__main__":
    unittest.main()
