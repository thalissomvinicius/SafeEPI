"""Immutable official OpenCV Zoo artifacts; never download at request/startup time."""
from pathlib import Path
import hashlib

MODEL_ID = "opencv-sface-2021dec"
MODEL_SHA256 = "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79"
ZOO_COMMIT = "47534e27c9851bb1128ccc0102f1145e27f23f98"
ARTIFACTS = {
    "yunet": {
        "filename": "face_detection_yunet_2023mar.onnx",
        "folder": "face_detection_yunet",
        "sha256": "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4",
        "size": 232589,
        "license": "MIT",
    },
    "sface": {
        "filename": "face_recognition_sface_2021dec.onnx",
        "folder": "face_recognition_sface",
        "sha256": MODEL_SHA256,
        "size": 38696353,
        "license": "Apache-2.0",
    },
}
for artifact in ARTIFACTS.values():
    artifact["url"] = f"https://media.githubusercontent.com/media/opencv/opencv_zoo/{ZOO_COMMIT}/models/{artifact['folder']}/{artifact['filename']}"
    artifact["license_url"] = f"https://raw.githubusercontent.com/opencv/opencv_zoo/{ZOO_COMMIT}/models/{artifact['folder']}/LICENSE"


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def checked_model_path(directory: Path, key: str) -> Path:
    artifact = ARTIFACTS[key]
    path = directory / artifact["filename"]
    if not path.is_file():
        raise RuntimeError("models_not_installed")
    if path.stat().st_size != artifact["size"] or file_sha256(path) != artifact["sha256"]:
        raise RuntimeError("model_integrity_failed")
    return path
