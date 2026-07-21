import os
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock

SERVICE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE_ROOT))
os.environ.setdefault("SAFE_EPI_BIOMETRIC_SERVICE_TOKEN", "test-token-with-sufficient-entropy")

fake_numpy = MagicMock()
fake_numpy.ndarray = object
sys.modules.setdefault("numpy", fake_numpy)

from app.services.antispoof import PassiveAntiSpoof
from app.services.session_store import SessionStore


class BiometricSecurityTests(unittest.TestCase):
    def test_placeholder_antispoof_never_approves_liveness(self):
        antispoof = PassiveAntiSpoof()
        image = object()

        self.assertFalse(antispoof.available)
        self.assertEqual(antispoof.score(image, [0, 0, 16, 16], 1.0), 0.0)

    def test_duplicate_frame_is_rejected(self):
        store = SessionStore(max_sessions=10)
        session = store.create("verify", None, None, require_liveness=True)

        self.assertTrue(session.accept_frame_hash("same-frame"))
        self.assertFalse(session.accept_frame_hash("same-frame"))

    def test_session_store_has_a_hard_capacity(self):
        store = SessionStore(max_sessions=2)
        store.create("verify", None, None)
        store.create("verify", None, None)

        with self.assertRaisesRegex(RuntimeError, "capacity"):
            store.create("verify", None, None)


if __name__ == "__main__":
    unittest.main()
