# Facial inference — third-party notices

## YuNet and SFace

The downloaded ONNX artifacts are pinned to OpenCV Zoo commit
`47534e27c9851bb1128ccc0102f1145e27f23f98`; names, size, SHA-256 and immutable
download/license URLs are in `app/model_manifest.py`. The installer verifies size
and SHA-256, preserves model license notices, and does not retrieve photos or datasets.

- YuNet `face_detection_yunet_2023mar.onnx`: MIT. Notice in `licenses/YuNet-MIT.txt`.
- SFace `face_recognition_sface_2021dec.onnx`: Apache-2.0. Text in `licenses/Apache-2.0.txt`.

The upstream model directories expressly say all files there are licensed under
those licenses. This is not a warranty of the entire provenance/consent chain for
the training datasets. Review that distinction before commercial activation.

## MiniFASNet adapter

`app/services/pad.py` adapts the bounding-box crop algorithm of
`src/generate_patches.py` from **Silent-Face-Anti-Spoofing**, Copyright 2020
Minivision, licensed under Apache-2.0 (full text in `licenses/Apache-2.0.txt`).
Modified for strict NumPy preprocessing and ONNX Runtime, with shape/finite checks.

Pinned source commit: `b6d5f04ad78778917853b25c778acef6d5626d15`:

- https://github.com/minivision-ai/Silent-Face-Anti-Spoofing/blob/b6d5f04ad78778917853b25c778acef6d5626d15/src/generate_patches.py
- https://github.com/minivision-ai/Silent-Face-Anti-Spoofing/blob/b6d5f04ad78778917853b25c778acef6d5626d15/src/data_io/functional.py
- https://github.com/minivision-ai/Silent-Face-Anti-Spoofing/blob/b6d5f04ad78778917853b25c778acef6d5626d15/src/anti_spoof_predict.py
- https://github.com/minivision-ai/Silent-Face-Anti-Spoofing/blob/b6d5f04ad78778917853b25c778acef6d5626d15/test.py

No MiniFASNet weights are bundled or downloaded automatically. Its runtime
adapter supports **only a reviewed export of MiniFASNetV2 2.7_80x80**: float BGR
0..255, NCHW [1,3,80,80], raw logits [1,3], live class index 1. The original
NumPy ToTensor function explicitly does NOT divide values by 255. This adapter
is a single-model path, not the upstream two-model fusion; evaluate this exact
pipeline. An arbitrary ONNX model with the same dimensions is not interchangeable.

Before configuring weights, confirm license of original weights and export,
retain notices, record source/export hashes and conversion tool versions, verify
numerical agreement of original and export, and validate the complete YuNet
detector + resizing + PAD pipeline on deployment cameras and attack scenarios.
An ONNX file or a configuration flag cannot establish such evidence.

ONNX Runtime is MIT; OpenCV is Apache-2.0. Package license metadata is distributed
with their wheels. The public InsightFace pretrained models are no longer used.
