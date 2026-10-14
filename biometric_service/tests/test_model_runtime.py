"""Optional actual graph smoke tests, never a face-accuracy benchmark."""
import io
import os
import sys
import unittest
from pathlib import Path

os.environ.setdefault("SAFE_EPI_BIOMETRIC_SERVICE_TOKEN", "test-token-with-sufficient-entropy")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi.testclient import TestClient
from PIL import Image
from app.main import app
from app.core.config import settings
from app.model_manifest import ARTIFACTS


@unittest.skipUnless(all((settings.models_dir / entry["filename"]).is_file() for entry in ARTIFACTS.values()),
                     "Run scripts/install_models.py for optional real-graph smoke")
class RealModelRuntimeTests(unittest.TestCase):
    def test_actual_models_are_ready_but_pad_is_not_fabricated(self):
        with TestClient(app) as client:
            health = client.get("/health").json()
            self.assertTrue(health["enrollment_ready"])
            self.assertFalse(health["verification_ready"])
            buffer = io.BytesIO()
            Image.new("RGB", (640, 480), "black").save(buffer, format="JPEG")
            response = client.post("/v2/enroll", headers={"Authorization": f"Bearer {settings.service_token}"},
                                   files={"frame": ("synthetic.jpg", buffer.getvalue(), "image/jpeg")})
            self.assertEqual(response.status_code, 422)
            self.assertEqual(response.json()["detail"], "no_face")


if __name__ == "__main__":
    unittest.main()
