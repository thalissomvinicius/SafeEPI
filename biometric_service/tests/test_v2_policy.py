"""Decision regression tests: enrollment is not proof of liveness."""
import math
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.verification import MODEL_ID, EMBEDDING_DIM, validate_embedding, verification_decision


class VerificationPolicyTests(unittest.TestCase):
    def test_sface_contract_is_versioned_128_dimensions(self):
        self.assertEqual(MODEL_ID, "opencv-sface-2021dec")
        self.assertEqual(EMBEDDING_DIM, 128)

    def test_old_insightface_vector_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "invalid_embedding"):
            validate_embedding([0.1] * 512)

    def test_nonfinite_and_zero_and_non_numeric_vectors_are_rejected(self):
        for values in ([math.nan] * 128, [math.inf] * 128, [0.0] * 128, [True] * 128, ["0.1"] * 128):
            with self.subTest(values=values[:1]):
                with self.assertRaisesRegex(ValueError, "invalid_embedding"):
                    validate_embedding(values)

    def test_missing_pad_cannot_approve_even_identical_faces(self):
        result = verification_decision(similarity=1.0, threshold=0.7, calibration_id="pilot-1", pad_score=None, pad_threshold=0.9, pad_model_id=None)
        self.assertEqual(result[0], "unavailable")

    def test_missing_calibration_cannot_approve(self):
        result = verification_decision(similarity=1.0, threshold=None, calibration_id=None, pad_score=0.99, pad_threshold=0.9, pad_model_id="test-pad")
        self.assertEqual(result, ("unavailable", "calibration_required"))

    def test_pad_fail_cannot_be_compensated_by_similarity(self):
        result = verification_decision(similarity=1.0, threshold=0.7, calibration_id="pilot-1", pad_score=0.5, pad_threshold=0.9, pad_model_id="test-pad")
        self.assertEqual(result, ("rejected", "presentation_attack_suspected"))

    def test_similarity_fail_cannot_be_compensated_by_pad(self):
        result = verification_decision(similarity=0.3, threshold=0.7, calibration_id="pilot-1", pad_score=1.0, pad_threshold=0.9, pad_model_id="test-pad")
        self.assertEqual(result, ("rejected", "identity_mismatch"))

    def test_only_all_independent_gates_approve(self):
        result = verification_decision(similarity=0.9, threshold=0.7, calibration_id="pilot-1", pad_score=0.99, pad_threshold=0.9, pad_model_id="test-pad")
        self.assertEqual(result, ("approved", "identity_verified"))

    def test_nonfinite_scores_never_approve(self):
        for field in ("similarity", "threshold", "pad_score", "pad_threshold"):
            args = dict(similarity=0.9, threshold=0.7, calibration_id="pilot-1", pad_score=0.99, pad_threshold=0.9, pad_model_id="test-pad")
            args[field] = math.nan
            self.assertNotEqual(verification_decision(**args)[0], "approved")


if __name__ == "__main__":
    unittest.main()
