"""CPU YuNet/SFace. OpenCV instances mutate, so inference is serialized."""
from threading import RLock
import cv2
import numpy as np

from app.core.config import settings
from app.model_manifest import checked_model_path
from app.services.quality import quality_score, instruction_for_quality
from app.services.verification import validate_embedding


class FaceEngine:
    def __init__(self) -> None:
        self._detector = None
        self._recognizer = None
        self._lock = RLock()
        self.readiness_reason = "models_not_loaded"

    @property
    def ready(self) -> bool:
        return self._detector is not None and self._recognizer is not None

    def load(self) -> None:
        with self._lock:
            if self.ready:
                return
            try:
                detector_path = checked_model_path(settings.models_dir, "yunet")
                recognizer_path = checked_model_path(settings.models_dir, "sface")
                cv2.setNumThreads(settings.cpu_threads)
                detector = cv2.FaceDetectorYN.create(str(detector_path), "", (320, 320), settings.min_face_score, 0.3, 5000)
                recognizer = cv2.FaceRecognizerSF.create(str(recognizer_path), "")
                self._detector, self._recognizer = detector, recognizer
                self.readiness_reason = "ready"
            except (RuntimeError, cv2.error, OSError) as error:
                self.readiness_reason = str(error) if str(error) in {"models_not_installed", "model_integrity_failed"} else "model_load_failed"
                raise RuntimeError(self.readiness_reason) from error

    def analyze(self, image: np.ndarray) -> dict:
        with self._lock:
            self.load()
            height, width = image.shape[:2]
            self._detector.setInputSize((width, height))
            _, faces = self._detector.detect(image)
            count = 0 if faces is None else len(faces)
            if count != 1:
                return {"ok": False, "reason": "multiple_faces" if count > 1 else "no_face", "face_count": count}
            face = faces[0]
            x, y, box_width, box_height = face[:4]
            bbox = np.array([x, y, x + box_width, y + box_height], dtype=np.float32)
            quality, parts = quality_score(image, bbox)
            reason, _ = instruction_for_quality(parts)
            if reason or quality < settings.min_quality_score:
                return {"ok": False, "reason": reason or "low_quality", "face_count": 1, "quality_score": quality}
            aligned = self._recognizer.alignCrop(image, face)
            feature = self._recognizer.feature(aligned).reshape(-1).astype(np.float64)
            norm = float(np.linalg.norm(feature))
            if not np.isfinite(norm) or norm <= 1e-8:
                raise RuntimeError("invalid_model_embedding")
            embedding = validate_embedding((feature / norm).tolist())
            return {"ok": True, "face_count": 1, "det_score": float(face[-1]),
                    "bbox": bbox.astype(float).tolist(), "embedding": embedding,
                    "quality_score": quality, "quality_parts": parts}


face_engine = FaceEngine()


def cosine_similarity(a: list[float], b: list[float]) -> float:
    a, b = validate_embedding(a), validate_embedding(b)
    return max(-1.0, min(1.0, sum(x * y for x, y in zip(a, b))))
