import hashlib
import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "export_pad.py"
spec = importlib.util.spec_from_file_location("safeepi_export_pad", SCRIPT)
export_pad = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = export_pad
spec.loader.exec_module(export_pad)


class PadExportTests(unittest.TestCase):
    def test_pinned_candidate_matches_reviewed_upstream(self):
        self.assertEqual(export_pad.UPSTREAM_COMMIT, "b6d5f04ad78778917853b25c778acef6d5626d15")
        self.assertEqual(export_pad.ARTIFACTS["weights"][1], "a5eb02e1843f19b5386b953cc4c9f011c3f985d0ee2bb9819eea9a142099bec0")

    def test_hash_mismatch_rejected_before_loading_python_or_pickle(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "untrusted.pth"
            path.write_bytes(b"not trusted")
            with self.assertRaisesRegex(ValueError, "sha256_mismatch"):
                export_pad.verified_bytes(path, "0" * 64, 100)

    def test_size_limit_rejects_resource_exhaustion(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "large"
            path.write_bytes(b"12345")
            with self.assertRaisesRegex(ValueError, "artifact_size"):
                export_pad.verified_bytes(path, hashlib.sha256(b"12345").hexdigest(), 4)

    def test_verified_buffer_is_exact_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "model"
            path.write_bytes(b"reviewed bytes")
            result = export_pad.verified_bytes(path, hashlib.sha256(b"reviewed bytes").hexdigest(), 100)
            self.assertEqual(result, b"reviewed bytes")

    def test_mixed_dataparallel_keys_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "mixed_prefix"):
            export_pad.normalize_state_keys({"module.conv": 1, "conv": 2})

    def test_dataparallel_prefix_removed_once(self):
        self.assertEqual(export_pad.normalize_state_keys({"module.conv": 1}), {"conv": 1})

    def test_invalid_state_dict_is_rejected(self):
        for state in ([], {}, {1: 2}):
            with self.assertRaisesRegex(ValueError, "invalid_state_dict"):
                export_pad.normalize_state_keys(state)

    def test_existing_output_never_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, "output_exists"):
                export_pad.export_candidate(Path(directory), Path(directory), None)

    def test_no_license_review_means_candidate_not_commercial_approval(self):
        self.assertEqual(export_pad.license_review_metadata(None), {"status": "pending", "sha256": None})

    def test_review_file_hash_is_recorded_not_interpreted_as_approval(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "review.md"
            path.write_text("Pending legal review", encoding="utf-8")
            result = export_pad.license_review_metadata(path)
            self.assertEqual(result["status"], "supplied_not_validated")
            self.assertEqual(result["sha256"], hashlib.sha256(path.read_bytes()).hexdigest())

    def test_state_loading_cannot_fallback_to_unrestricted_pickle(self):
        class TorchStub:
            @staticmethod
            def load(buffer, **kwargs):
                self.assertEqual(buffer.read(), b"reviewed weights")
                self.assertEqual(kwargs, {"map_location": "cpu", "weights_only": True})
                raise RuntimeError("unsupported_safe_weights")

        with self.assertRaisesRegex(RuntimeError, "unsupported_safe_weights"):
            export_pad.load_weights(TorchStub, b"reviewed weights")

    def test_numerical_equivalence_accepts_only_finite_three_class_logits(self):
        self.assertEqual(export_pad.compare_logits([[1.0, 2.0, -3.0]], [[1.0, 2.0, -3.0]]), 0.0)
        for expected, actual, message in (
            ([[1, 2, 3]], [[1, 2]], "invalid_logits_shape"),
            ([[1, 2, 3]], [[1, float("nan"), 3]], "nonfinite_logits"),
            ([[1, 2, 3]], [[1, 8, 3]], "numerical_equivalence_failed"),
        ):
            with self.assertRaisesRegex(ValueError, message):
                export_pad.compare_logits(expected, actual)

    def test_old_or_unpinned_runtime_refused_before_loading_checkpoint(self):
        versions = dict(export_pad.EXPECTED_VERSIONS)
        versions["torch"] = "2.5.0"
        with self.assertRaisesRegex(ValueError, "unpinned_dependency: torch"):
            export_pad.verify_runtime_versions(versions)

    def test_cpu_local_version_suffix_is_allowed_and_recorded(self):
        versions = dict(export_pad.EXPECTED_VERSIONS)
        versions["torch"] += "+cpu"
        export_pad.verify_runtime_versions(versions)

    def test_arbitrary_local_build_is_not_implicitly_trusted(self):
        versions = dict(export_pad.EXPECTED_VERSIONS)
        versions["torch"] += "+custom"
        with self.assertRaisesRegex(ValueError, "unpinned_dependency"):
            export_pad.verify_runtime_versions(versions)


if __name__ == "__main__":
    unittest.main()
