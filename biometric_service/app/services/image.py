import cv2
import numpy as np
from io import BytesIO
from PIL import Image, UnidentifiedImageError

from app.core.config import settings


def decode_image(image_bytes: bytes) -> np.ndarray:
    if len(image_bytes) > settings.max_frame_bytes:
        raise ValueError("frame_too_large")

    # Inspect dimensions before OpenCV allocates decoded pixels.
    try:
        with Image.open(BytesIO(image_bytes)) as header:
            width, height = header.size
            if header.format not in {"JPEG", "PNG"}:
                raise ValueError("unsupported_image_format")
            if width < 80 or height < 80 or width * height > settings.max_image_pixels or max(width, height) > 4096:
                raise ValueError("invalid_image_dimensions")
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as error:
        raise ValueError("invalid_image") from error
    arr = np.frombuffer(image_bytes, np.uint8)
    image = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("invalid_image")
    scale = min(1.0, settings.max_inference_dimension / max(image.shape[:2]))
    if scale < 1:
        image = cv2.resize(image, (round(image.shape[1] * scale), round(image.shape[0] * scale)), interpolation=cv2.INTER_AREA)
    return image


def image_sha256(image_bytes: bytes) -> str:
    import hashlib

    return hashlib.sha256(image_bytes).hexdigest()
