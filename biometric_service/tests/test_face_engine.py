import os
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

os.environ.setdefault("SAFE_EPI_BIOMETRIC_SERVICE_TOKEN", "test-token-with-sufficient-entropy")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import numpy as np
from app.services.face_engine import FaceEngine


class FaceEngineContractTests(unittest.TestCase):
    def engine(self, faces):
        engine = FaceEngine()
        engine._detector = MagicMock()
        engine._recognizer = MagicMock()
        engine._detector.detect.return_value = (None, faces)
        engine._recognizer.feature.return_value = np.ones((1, 128), dtype=np.float32)
        return engine

    def test_multiple_faces_do_not_generate_embedding(self):
        engine = self.engine(np.ones((2, 15), dtype=np.float32))
        result = engine.analyze(np.zeros((100, 100, 3), dtype=np.uint8))
        self.assertEqual(result["reason"], "multiple_faces")
        engine._recognizer.feature.assert_not_called()

    def test_bad_quality_does_not_generate_embedding(self):
        engine = self.engine(np.ones((1, 15), dtype=np.float32))
        with patch("app.services.face_engine.quality_score", return_value=(0.1, {"blur": 0.1})):
            result = engine.analyze(np.zeros((100, 100, 3), dtype=np.uint8))
        self.assertFalse(result["ok"])
        engine._recognizer.feature.assert_not_called()

    def test_feature_is_aligned_and_normalized_128d(self):
        engine = self.engine(np.ones((1, 15), dtype=np.float32))
        with patch("app.services.face_engine.quality_score", return_value=(0.9, {"blur": 0.9})):
            result = engine.analyze(np.zeros((100, 100, 3), dtype=np.uint8))
        engine._recognizer.alignCrop.assert_called_once()
        self.assertEqual(len(result["embedding"]), 128)
        self.assertAlmostEqual(float(np.linalg.norm(result["embedding"])), 1.0)

    def test_wrong_dimension_from_model_cannot_create_legacy_template(self):
        engine = self.engine(np.ones((1, 15), dtype=np.float32))
        engine._recognizer.feature.return_value = np.ones((1, 512), dtype=np.float32)
        with patch("app.services.face_engine.quality_score", return_value=(0.9, {"blur": 0.9})):
            with self.assertRaisesRegex(ValueError, "invalid_embedding"):
                engine.analyze(np.zeros((100, 100, 3), dtype=np.uint8))


if __name__ == "__main__":
    unittest.main()
