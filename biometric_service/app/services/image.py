import cv2
import numpy as np

from app.core.config import settings


def decode_image(image_bytes: bytes) -> np.ndarray:
    if len(image_bytes) > settings.max_frame_bytes:
        raise ValueError("frame_too_large")

    arr = np.frombuffer(image_bytes, np.uint8)
    image = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("invalid_image")
    return image


def image_sha256(image_bytes: bytes) -> str:
    import hashlib

    return hashlib.sha256(image_bytes).hexdigest()
