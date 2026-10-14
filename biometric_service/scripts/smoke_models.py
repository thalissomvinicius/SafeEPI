"""Real inference on synthetic pixels only. Not accuracy/PAD validation."""
import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("SAFE_EPI_BIOMETRIC_SERVICE_TOKEN", "smoke-only-token-not-a-production-secret")
import numpy as np
from app.model_manifest import MODEL_ID, MODEL_SHA256
from app.services.face_engine import face_engine

started = time.perf_counter()
face_engine.load()
loaded = time.perf_counter()
blank = np.zeros((480, 640, 3), dtype=np.uint8)
result = face_engine.analyze(blank)
detected = time.perf_counter()
assert result["ok"] is False and result["reason"] == "no_face"
# A synthetic aligned input exercises the recognizer graph, not enrollment.
feature = face_engine._recognizer.feature(np.zeros((112, 112, 3), dtype=np.uint8))
assert feature.shape == (1, 128) and np.isfinite(feature).all()
finished = time.perf_counter()
print(json.dumps({"model_id": MODEL_ID, "model_sha256": MODEL_SHA256,
    "load_ms": round((loaded - started) * 1000, 1),
    "synthetic_no_face_ms": round((detected - loaded) * 1000, 1),
    "synthetic_feature_ms": round((finished - detected) * 1000, 1),
    "synthetic_feature_dimensions": int(feature.shape[1]), "result": result,
    "accuracy_validated": False, "pad_validated": False}, indent=2))
