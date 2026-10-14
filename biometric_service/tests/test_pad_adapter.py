import os
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock

os.environ.setdefault("SAFE_EPI_BIOMETRIC_SERVICE_TOKEN", "test-token-with-sufficient-entropy")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import numpy as np
from app.services.pad import crop_minifasnet, MiniFasNetPad


class PadAdapterTests(unittest.TestCase):
    def test_preprocess_is_bgr_0_to_255_not_rgb_normalized(self):
        image = np.zeros((160, 120, 3), dtype=np.uint8)
        image[:, :, 0] = 40
        image[:, :, 1] = 90
        image[:, :, 2] = 210
        tensor = crop_minifasnet(image, [20, 30, 70, 100])
        self.assertEqual(tensor.shape, (1, 3, 80, 80))
        self.assertEqual(tensor.dtype, np.float32)
        np.testing.assert_equal(tensor[0, :, 40, 40], [40, 90, 210])

    def test_cropping_preserves_context_at_edges(self):
        image = np.ones((100, 100, 3), dtype=np.uint8)
        tensor = crop_minifasnet(image, [0, 0, 40, 40])
        self.assertEqual(tensor.shape, (1, 3, 80, 80))

    def test_live_probability_is_softmax_class_one(self):
        session = MagicMock()
        session.get_inputs.return_value = [MagicMock(name="input", shape=[1, 3, 80, 80], type="tensor(float)")]
        session.get_inputs.return_value[0].name = "input"
        session.run.return_value = [np.array([[0.0, 8.0, 0.0]], dtype=np.float32)]
        adapter = MiniFasNetPad(session)
        self.assertGreater(adapter.score(np.zeros((100, 100, 3), dtype=np.uint8), [20, 20, 60, 60]), 0.99)

    def test_nonfinite_or_wrong_output_shape_fails_closed(self):
        session = MagicMock()
        session.get_inputs.return_value = [MagicMock()]
        session.get_inputs.return_value[0].name = "input"
        for output in (np.array([[0.0, np.nan, 0.0]]), np.ones((1, 2))):
            session.run.return_value = [output]
            with self.assertRaisesRegex(RuntimeError, "pad_invalid_output"):
                MiniFasNetPad(session).score(np.zeros((100, 100, 3), dtype=np.uint8), [20, 20, 60, 60])


if __name__ == "__main__":
    unittest.main()
