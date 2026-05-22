import cv2
import numpy as np


def clamp(value: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, value))


def blur_score(gray: np.ndarray) -> float:
    variance = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    return clamp((variance - 40.0) / 220.0)


def brightness_score(gray: np.ndarray) -> float:
    mean = float(gray.mean())
    if 80 <= mean <= 185:
        return 1.0
    if mean < 80:
        return clamp(mean / 80.0)
    return clamp((255.0 - mean) / 70.0)


def exposure_dynamic_range_score(gray: np.ndarray) -> float:
    p5, p95 = np.percentile(gray, [5, 95])
    dynamic_range = float(p95 - p5)
    return clamp((dynamic_range - 35.0) / 120.0)


def face_size_score(face_bbox: np.ndarray, image_shape: tuple[int, int, int]) -> float:
    h, w = image_shape[:2]
    x1, y1, x2, y2 = face_bbox
    area_ratio = max(0.0, float((x2 - x1) * (y2 - y1)) / float(w * h))
    if 0.12 <= area_ratio <= 0.42:
        return 1.0
    if area_ratio < 0.12:
        return clamp(area_ratio / 0.12)
    return clamp((0.62 - area_ratio) / 0.20)


def center_score(face_bbox: np.ndarray, image_shape: tuple[int, int, int]) -> float:
    h, w = image_shape[:2]
    x1, y1, x2, y2 = face_bbox
    cx = (x1 + x2) / 2.0
    cy = (y1 + y2) / 2.0
    dx = abs(cx - w / 2.0) / (w / 2.0)
    dy = abs(cy - h / 2.0) / (h / 2.0)
    return clamp(1.0 - max(dx, dy))


def quality_score(image: np.ndarray, face_bbox: np.ndarray) -> tuple[float, dict[str, float]]:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    parts = {
        "brightness": brightness_score(gray),
        "blur": blur_score(gray),
        "face_size": face_size_score(face_bbox, image.shape),
        "center": center_score(face_bbox, image.shape),
        "exposure_dynamic_range": exposure_dynamic_range_score(gray),
    }
    weights = {
        "brightness": 0.22,
        "blur": 0.22,
        "face_size": 0.22,
        "center": 0.20,
        "exposure_dynamic_range": 0.14,
    }
    total = sum(parts[key] * weights[key] for key in parts)
    return clamp(total), parts


def instruction_for_quality(parts: dict[str, float]) -> tuple[str | None, str | None]:
    weakest = min(parts, key=parts.get)
    value = parts[weakest]
    if value >= 0.55:
        return None, None

    if weakest == "face_size":
        return "low_face_size", "Chegue um pouco mais perto"
    if weakest == "brightness":
        return "low_light", "Vire o rosto para a luz"
    if weakest == "blur":
        return "blur", "Segure o celular parado por um instante"
    if weakest == "center":
        return "off_center", "Centralize seu rosto no circulo"
    return "poor_exposure", "Evite contraluz ou luz estourada"
