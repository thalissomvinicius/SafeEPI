"""Offline, pinned MiniFASNetV2 candidate export; never activates biometric approval.

Only the reviewed upstream source, checkpoint and license are accepted. Conversion
uses synthetic pixels, not employee photos. Run in a disposable export environment.
"""
from __future__ import annotations

import argparse
from collections.abc import Mapping
import hashlib
import io
import json
import platform
from pathlib import Path
import tempfile
import types

UPSTREAM_COMMIT = "b6d5f04ad78778917853b25c778acef6d5626d15"
UPSTREAM_REPOSITORY = "https://github.com/minivision-ai/Silent-Face-Anti-Spoofing"
MODEL_ID = "minifasnetv2-2.7-80x80"
PREPROCESS_ID = "yunet-2023mar-max960-minifasnet-2.7-bgr-0-255-nchw-80-v1"
EXPECTED_VERSIONS = {"torch": "2.14.1", "onnx": "1.23.2", "onnxruntime": "1.24.2", "numpy": "2.4.6"}
ARTIFACTS = {
    "source": ("src/model_lib/MiniFASNet.py", "e498c4ec5e1ddfaba62b941a126c19d65aa564999f3309661fe43ee8bf38acd7", 100_000),
    "weights": ("resources/anti_spoof_models/2.7_80x80_MiniFASNetV2.pth", "a5eb02e1843f19b5386b953cc4c9f011c3f985d0ee2bb9819eea9a142099bec0", 3_000_000),
    "license": ("LICENSE", "daf94bf1dc9cc5700fe5af2c7c0cbd1836e70d509ed78fd0bebef7432edee6fb", 30_000),
}


def verified_bytes(path: Path, expected_sha256: str, max_bytes: int) -> bytes:
    with path.open("rb") as stream:
        data = stream.read(max_bytes + 1)
    if not data or len(data) > max_bytes:
        raise ValueError(f"artifact_size: {path.name}")
    if hashlib.sha256(data).hexdigest() != expected_sha256:
        raise ValueError(f"sha256_mismatch: {path.name}")
    return data


def normalize_state_keys(state) -> dict:
    if not isinstance(state, Mapping) or not state or not all(isinstance(key, str) for key in state):
        raise ValueError("invalid_state_dict")
    prefixes = [key.startswith("module.") for key in state]
    if any(prefixes) and not all(prefixes):
        raise ValueError("mixed_prefix")
    return {key[7:] if all(prefixes) else key: value for key, value in state.items()}


def load_weights(torch, data: bytes) -> dict:
    # Intentionally no retry with weights_only=False or custom safe-global bypass.
    state = torch.load(io.BytesIO(data), map_location="cpu", weights_only=True)
    return normalize_state_keys(state)


def verify_runtime_versions(versions: dict) -> None:
    for name, expected in EXPECTED_VERSIONS.items():
        allowed = {expected, expected + "+cpu"} if name == "torch" else {expected}
        if str(versions.get(name, "")) not in allowed:
            raise ValueError(f"unpinned_dependency: {name}; install requirements-export.txt")


def license_review_metadata(path: Path | None) -> dict:
    if path is None:
        return {"status": "pending", "sha256": None}
    with path.open("rb") as stream:
        data = stream.read(1_000_001)
    if not data.strip() or len(data) > 1_000_000:
        raise ValueError("invalid_license_review")
    # A supplied document is traceability, not machine-certified legal approval.
    return {"status": "supplied_not_validated", "sha256": hashlib.sha256(data).hexdigest()}


def compare_logits(expected, actual) -> float:
    import numpy as np

    expected = np.asarray(expected)
    actual = np.asarray(actual)
    if expected.shape != (1, 3) or actual.shape != (1, 3):
        raise ValueError("invalid_logits_shape")
    if not np.isfinite(expected).all() or not np.isfinite(actual).all():
        raise ValueError("nonfinite_logits")
    if not np.allclose(expected, actual, rtol=1e-4, atol=1e-5):
        raise ValueError("numerical_equivalence_failed")
    return float(np.max(np.abs(expected - actual)))


def export_candidate(source_dir: Path, output_dir: Path, license_review: Path | None) -> dict:
    if output_dir.exists():
        raise ValueError("output_exists: choose a new empty destination")
    if not output_dir.parent.is_dir():
        raise ValueError("output_parent_missing")
    buffers = {
        label: verified_bytes(source_dir / relative, digest, limit)
        for label, (relative, digest, limit) in ARTIFACTS.items()
    }
    review = license_review_metadata(license_review)

    # Heavy optional dependencies are never imported by the production service.
    import numpy as np
    import onnx
    import onnxruntime as ort
    import torch

    versions = {"torch": str(torch.__version__), "onnx": onnx.__version__, "onnxruntime": ort.__version__, "numpy": np.__version__}
    verify_runtime_versions(versions)
    torch.set_num_threads(1)
    torch.manual_seed(0)
    torch.use_deterministic_algorithms(True)
    module = types.ModuleType("safeepi_reviewed_minifasnet")
    # Execute only the exact already-hashed bytes, not a mutable file/import path.
    exec(compile(buffers["source"], "reviewed/MiniFASNet.py", "exec"), module.__dict__)
    model = module.MiniFASNetV2(conv6_kernel=(5, 5)).cpu().eval()
    state = load_weights(torch, buffers["weights"])
    if not all(isinstance(value, torch.Tensor) for value in state.values()):
        raise ValueError("non_tensor_weights")
    model.load_state_dict(state, strict=True)

    rng = np.random.default_rng(20261013)
    shape = (1, 3, 80, 80)
    cases = [
        ("black", np.zeros(shape, dtype=np.float32)),
        ("white", np.full(shape, 255, dtype=np.float32)),
        ("gradient", np.linspace(0, 255, np.prod(shape), dtype=np.float32).reshape(shape)),
    ] + [(f"noise_{index}", rng.integers(0, 256, shape).astype(np.float32)) for index in range(3)]

    with tempfile.TemporaryDirectory(prefix="safeepi-pad-export-", dir=output_dir.parent) as staging:
        stage = Path(staging)
        model_path = stage / f"{MODEL_ID}.onnx"
        with torch.inference_mode():
            torch.onnx.export(
                model, torch.from_numpy(cases[0][1]), str(model_path),
                export_params=True, opset_version=17, do_constant_folding=True,
                input_names=["input"], output_names=["logits"],
                dynamo=False, external_data=False,
            )
        onnx.checker.check_model(onnx.load(str(model_path)), full_check=True)
        options = ort.SessionOptions()
        options.intra_op_num_threads = 1
        options.inter_op_num_threads = 1
        session = ort.InferenceSession(str(model_path), sess_options=options, providers=["CPUExecutionProvider"])
        if len(session.get_inputs()) != 1 or session.get_inputs()[0].shape != [1, 3, 80, 80]:
            raise ValueError("invalid_onnx_input")
        if len(session.get_outputs()) != 1 or session.get_outputs()[0].shape != [1, 3]:
            raise ValueError("invalid_onnx_output")
        checks = []
        for name, pixels in cases:
            with torch.inference_mode():
                expected = model(torch.from_numpy(pixels)).cpu().numpy()
            actual = session.run(["logits"], {"input": pixels})[0]
            checks.append({"case": name, "max_absolute_error": compare_logits(expected, actual)})
        manifest = {
            "status": "candidate_not_calibrated", "production_approved": False,
            "model_id": MODEL_ID, "preprocess_id": PREPROCESS_ID,
            "upstream_repository": UPSTREAM_REPOSITORY, "upstream_commit": UPSTREAM_COMMIT,
            "upstream_artifacts": {key: {"path": item[0], "sha256": item[1]} for key, item in ARTIFACTS.items()},
            "onnx_file": model_path.name, "onnx_sha256": hashlib.sha256(model_path.read_bytes()).hexdigest(),
            "opset": 17, "input": "float32[1,3,80,80] BGR 0..255, no normalization",
            "output": "raw float32 logits[1,3]; runtime applies softmax; live class index 1",
            "license_review": review,
            "versions": {"python": platform.python_version(), **versions},
            "platform": platform.platform(),
            "numerical_equivalence": {"synthetic_only": True, "rtol": 1e-4, "atol": 1e-5, "cases": checks},
            "limitations": ["Not a PAD accuracy evaluation", "Not a commercial license opinion", "No calibration or threshold produced", "No employee images used"],
        }
        (stage / "LICENSE-Minivision.txt").write_bytes(buffers["license"])
        (stage / "export-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        # Directory rename publishes only a complete, checked candidate; never overwrite.
        stage.rename(output_dir)
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path, required=True, help="Pinned official checkout; no automatic network/download")
    parser.add_argument("--output-dir", type=Path, required=True, help="New destination directory; existing content is never replaced")
    parser.add_argument("--license-review", type=Path, help="Optional local review document, hashed only; does not authorize production")
    args = parser.parse_args()
    try:
        manifest = export_candidate(args.source_dir.resolve(), args.output_dir.resolve(), args.license_review)
    except (ValueError, OSError, ImportError, RuntimeError) as error:
        parser.exit(1, f"Export refused: {error}\n")
    print(json.dumps({"status": manifest["status"], "onnx_sha256": manifest["onnx_sha256"], "production_approved": False}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
