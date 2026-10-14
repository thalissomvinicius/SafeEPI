"""MiniFASNetV2 ONNX adapter, inactive until an operator-reviewed calibration exists.

Crop algorithm adapted from Minivision src/generate_patches.py (Apache-2.0,
Copyright 2020 Minivision), commit b6d5f04ad78778917853b25c778acef6d5626d15.
Modified: NumPy NCHW preparation, ONNX inference, strict output validation.
Original ToTensor(ndarray) keeps BGR values 0..255 (despite its docstring).
See THIRD_PARTY_NOTICES.md. This is not evidence of PAD accuracy/certification.
"""
import numpy as np
import cv2

PAD_MODEL_ID = "minifasnetv2-2.7-80x80"
PREPROCESS_ID = "yunet-2023mar-max960-minifasnet-2.7-bgr-0-255-nchw-80-v1"


def crop_minifasnet(image: np.ndarray, bbox: list[float]) -> np.ndarray:
    src_h, src_w = image.shape[:2]
    x, y, x2, y2 = bbox
    box_w, box_h = x2 - x, y2 - y
    if not np.isfinite(bbox).all() or box_w <= 1 or box_h <= 1:
        raise RuntimeError("pad_invalid_bbox")
    scale = min((src_h - 1) / box_h, (src_w - 1) / box_w, 2.7)
    new_width, new_height = box_w * scale, box_h * scale
    center_x, center_y = box_w / 2 + x, box_h / 2 + y
    left, top = center_x - new_width / 2, center_y - new_height / 2
    right, bottom = center_x + new_width / 2, center_y + new_height / 2
    if left < 0:
        right -= left
        left = 0
    if top < 0:
        bottom -= top
        top = 0
    if right > src_w - 1:
        left -= right - src_w + 1
        right = src_w - 1
    if bottom > src_h - 1:
        top -= bottom - src_h + 1
        bottom = src_h - 1
    crop = image[max(0, int(top)):int(bottom) + 1, max(0, int(left)):int(right) + 1]
    if crop.size == 0:
        raise RuntimeError("pad_invalid_bbox")
    crop = cv2.resize(crop, (80, 80), interpolation=cv2.INTER_LINEAR)
    return np.ascontiguousarray(crop.transpose(2, 0, 1)[None], dtype=np.float32)


class MiniFasNetPad:
    def __init__(self, session) -> None:
        self.session = session
        self.input_name = session.get_inputs()[0].name

    def score(self, image: np.ndarray, bbox: list[float]) -> float:
        outputs = self.session.run(None, {self.input_name: crop_minifasnet(image, bbox)})
        if len(outputs) != 1:
            raise RuntimeError("pad_invalid_output")
        logits = np.asarray(outputs[0], dtype=np.float64)
        if logits.shape != (1, 3) or not np.isfinite(logits).all():
            raise RuntimeError("pad_invalid_output")
        # The reviewed export must return raw logits, not already-softmax scores.
        exp = np.exp(logits[0] - np.max(logits[0]))
        probabilities = exp / exp.sum()
        # Official label 1 is bona fide; labels 0 and 2 are attack classes.
        return float(probabilities[1])
