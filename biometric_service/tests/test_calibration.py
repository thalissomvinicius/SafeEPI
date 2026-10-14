import os
import sys
import unittest
from pathlib import Path

os.environ.setdefault("SAFE_EPI_BIOMETRIC_SERVICE_TOKEN", "test-token-with-sufficient-entropy")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from pydantic import ValidationError
from app.model_manifest import MODEL_ID, MODEL_SHA256, ARTIFACTS
from app.services.calibration import CalibrationRecord, CalibrationRuntime


def record_values():
    return dict(schema_version=1, approved=True, calibration_id="unit-test-only", approved_by="unit test",
                valid_until="2099-01-01T00:00:00Z", model_id=MODEL_ID, model_sha256=MODEL_SHA256,
                detector_sha256=ARTIFACTS["yunet"]["sha256"], similarity_threshold=0.8,
                pad_model_id="minifasnetv2-2.7-80x80", pad_filename="test.onnx", pad_sha256="a" * 64,
                pad_threshold=0.95, pad_preprocessing="yunet-2023mar-max960-minifasnet-2.7-bgr-0-255-nchw-80-v1",
                pad_output="logits-1x3-live-index-1", validation_report_filename="report.json",
                validation_report_sha256="b" * 64, commercial_use_review_ref="unit-test-no-commercial-approval",
                validated_attacks=["printed_photo", "screen_photo", "screen_video"])


class CalibrationTests(unittest.TestCase):
    def test_empty_deployment_cannot_verify(self):
        self.assertFalse(CalibrationRuntime().ready)

    def test_unapproved_record_is_rejected(self):
        values = record_values()
        values["approved"] = False
        with self.assertRaises(ValidationError):
            CalibrationRecord(**values)

    def test_changed_recognizer_or_detector_requires_recalibration(self):
        for field in ("model_sha256", "detector_sha256"):
            values = record_values()
            values[field] = "c" * 64
            with self.assertRaisesRegex(ValueError, "model_mismatch"):
                CalibrationRecord(**values).assert_usable()

    def test_expired_calibration_cannot_verify(self):
        values = record_values()
        values["valid_until"] = "2020-01-01T00:00:00Z"
        with self.assertRaisesRegex(ValueError, "expired"):
            CalibrationRecord(**values).assert_usable()

    def test_missing_attack_evaluation_cannot_verify(self):
        values = record_values()
        values["validated_attacks"] = ["printed_photo"]
        with self.assertRaisesRegex(ValueError, "attack_tests_required"):
            CalibrationRecord(**values).assert_usable()

    def test_path_traversal_not_accepted(self):
        values = record_values()
        values["pad_filename"] = "../model.onnx"
        with self.assertRaises(ValidationError):
            CalibrationRecord(**values)


if __name__ == "__main__":
    unittest.main()
