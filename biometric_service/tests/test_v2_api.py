import io
import json
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
from types import SimpleNamespace

os.environ.setdefault("SAFE_EPI_BIOMETRIC_SERVICE_TOKEN", "test-token-with-sufficient-entropy")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi.testclient import TestClient
from PIL import Image
from app.main import app
from app.model_manifest import MODEL_ID, MODEL_SHA256


def frame_bytes():
    buffer = io.BytesIO()
    Image.new("RGB", (640, 480), "gray").save(buffer, format="JPEG")
    return buffer.getvalue()


GOOD_ANALYSIS = {"ok": True, "embedding": [1 / 128 ** 0.5] * 128, "quality_score": 0.9,
                 "quality_parts": {"center": 0.9}, "bbox": [100, 100, 300, 300]}


class V2ApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.headers = {"Authorization": "Bearer test-token-with-sufficient-entropy"}

    def request(self, path, data=None, body=None):
        return self.client.post(path, headers=self.headers, data=data or {},
                                files={"frame": ("frame.jpg", frame_bytes() if body is None else body, "image/jpeg")})

    def test_service_auth_required(self):
        result = self.client.post("/v2/enroll", files={"frame": ("a.jpg", frame_bytes(), "image/jpeg")})
        self.assertEqual(result.status_code, 401)

    def test_enrollment_uses_server_engine_and_version(self):
        with patch("app.routes.v2.face_engine.analyze", return_value=GOOD_ANALYSIS):
            result = self.request("/v2/enroll")
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()["model_id"], MODEL_ID)
        self.assertEqual(result.json()["model_sha256"], MODEL_SHA256)
        self.assertEqual(len(result.json()["embedding"]), 128)

    def test_no_face_or_multiple_faces_cannot_enroll(self):
        for reason in ("no_face", "multiple_faces", "blur"):
            with patch("app.routes.v2.face_engine.analyze", return_value={"ok": False, "reason": reason}):
                self.assertEqual(self.request("/v2/enroll").status_code, 422)

    def test_unavailable_models_do_not_create_dummy_embedding(self):
        with patch("app.routes.v2.face_engine.analyze", side_effect=RuntimeError("models_not_installed")):
            result = self.request("/v2/enroll")
        self.assertEqual(result.status_code, 503)
        self.assertNotIn("embedding", result.json())

    def test_invalid_image_is_a_client_error(self):
        self.assertEqual(self.request("/v2/enroll", body=b"not-an-image").status_code, 422)

    def test_reference_model_mismatch_is_not_silently_converted(self):
        result = self.request("/v2/verify", {"reference_embedding": json.dumps([0.1] * 512), "reference_model_id": "buffalo_l"})
        self.assertEqual(result.status_code, 422)

    def test_pad_unavailable_never_returns_embedding_or_approval(self):
        with patch("app.routes.v2.face_engine.analyze", return_value=GOOD_ANALYSIS):
            result = self.request("/v2/verify", {"reference_embedding": json.dumps([0.1] * 128), "reference_model_id": MODEL_ID})
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()["decision"], "unavailable")
        self.assertNotIn("embedding", result.json())

    def test_legacy_endpoints_cannot_bypass_v2(self):
        for path in ("/biometric/enroll", "/biometric/session/start", "/biometric/session/frame"):
            with self.subTest(path=path):
                self.assertEqual(self.request(path).status_code, 410)

    def test_oversize_request_rejected_before_decoding(self):
        self.assertEqual(self.request("/v2/enroll", body=b"x" * 2_200_000).status_code, 413)

    def test_mock_calibrated_path_has_independent_pad_and_identity_gates(self):
        # Protocol tests only: these injected scores are not empirical PAD validation.
        for pad_score, expected in ((0.2, "rejected"), (0.99, "approved")):
            runtime = SimpleNamespace(ready=True, reason="ready", record=SimpleNamespace(
                similarity_threshold=0.8, pad_threshold=0.95, pad_model_id="test-only-pad",
                calibration_id="test-only-calibration"), pad=SimpleNamespace(score=lambda image, bbox: pad_score))
            with patch("app.routes.v2.calibration", runtime), patch("app.routes.v2.face_engine.analyze", return_value=GOOD_ANALYSIS):
                result = self.request("/v2/verify", {"reference_embedding": json.dumps([0.1] * 128), "reference_model_id": MODEL_ID})
            self.assertEqual(result.json()["decision"], expected)
            self.assertEqual(result.json()["pad_threshold"], 0.95)
            self.assertNotIn("embedding", result.json())

    def test_invalid_reference_values_rejected(self):
        for values in ([0.1] * 512, [True] * 128, [0.0] * 128):
            result = self.request("/v2/verify", {"reference_embedding": json.dumps(values), "reference_model_id": MODEL_ID})
            self.assertEqual(result.status_code, 422)

    def test_capacity_does_not_create_an_unbounded_queue(self):
        from app.routes.v2 import inference_slots
        self.assertTrue(inference_slots.acquire(blocking=False))
        try:
            result = self.request("/v2/enroll")
            self.assertEqual(result.status_code, 503)
            self.assertEqual(result.headers["retry-after"], "2")
        finally:
            inference_slots.release()

    def test_large_decoded_image_rejected_even_when_small_compressed(self):
        buffer = io.BytesIO()
        Image.new("RGB", (4097, 80), "gray").save(buffer, format="PNG")
        self.assertEqual(self.request("/v2/enroll", body=buffer.getvalue()).status_code, 422)


if __name__ == "__main__":
    unittest.main()
