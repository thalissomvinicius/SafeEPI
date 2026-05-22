import numpy as np

from app.core.config import settings
from app.services.quality import quality_score


class FaceEngine:
    def __init__(self) -> None:
        self._app = None

    def load(self) -> None:
        if self._app is not None:
            return
        from insightface.app import FaceAnalysis

        app = FaceAnalysis(name=settings.insightface_model, providers=["CPUExecutionProvider"])
        app.prepare(ctx_id=-1, det_size=(settings.det_size, settings.det_size))
        self._app = app

    def analyze(self, image: np.ndarray) -> dict:
        self.load()
        faces = self._app.get(image)  # type: ignore[union-attr]
        if len(faces) != 1:
            return {
                "ok": False,
                "reason": "multiple_faces" if len(faces) > 1 else "no_face",
                "face_count": len(faces),
            }

        face = faces[0]
        if float(face.det_score) < settings.min_face_score:
            return {"ok": False, "reason": "low_detection_score", "face_count": 1}

        q_score, q_parts = quality_score(image, face.bbox)

        return {
            "ok": True,
            "face_count": 1,
            "det_score": float(face.det_score),
            "bbox": face.bbox.astype(float).tolist(),
            "landmarks": face.kps.astype(float).tolist() if getattr(face, "kps", None) is not None else [],
            "embedding": face.normed_embedding.astype(float).tolist(),
            "quality_score": q_score,
            "quality_parts": q_parts,
        }


face_engine = FaceEngine()


def cosine_similarity(a: list[float], b: list[float]) -> float:
    va = np.asarray(a, dtype=np.float32)
    vb = np.asarray(b, dtype=np.float32)
    denom = float(np.linalg.norm(va) * np.linalg.norm(vb))
    if denom == 0:
        return 0.0
    return float(np.dot(va, vb) / denom)
