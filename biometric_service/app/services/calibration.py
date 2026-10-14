"""Deployment calibration binds exact recognition/PAD artifacts and report hashes.

The record attests an external validation, it cannot perform or prove that study.
No environment variable can skip the required record or turn PAD into a constant.
"""
from datetime import datetime, timezone
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field

from app.core.config import settings
from app.model_manifest import ARTIFACTS, MODEL_ID, MODEL_SHA256, file_sha256
from app.services.pad import MiniFasNetPad


class CalibrationRecord(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    schema_version: Literal[1]
    approved: Literal[True]
    calibration_id: str = Field(min_length=8, max_length=120)
    approved_by: str = Field(min_length=3, max_length=200)
    valid_until: str
    model_id: Literal["opencv-sface-2021dec"]
    model_sha256: str = Field(pattern="^[0-9a-f]{64}$")
    detector_sha256: str = Field(pattern="^[0-9a-f]{64}$")
    similarity_threshold: float = Field(gt=0, le=1, allow_inf_nan=False)
    pad_model_id: Literal["minifasnetv2-2.7-80x80"]
    pad_filename: str = Field(pattern=r"^[a-zA-Z0-9_.-]+\.onnx$")
    pad_sha256: str = Field(pattern="^[0-9a-f]{64}$")
    pad_threshold: float = Field(gt=0.5, le=1, allow_inf_nan=False)
    pad_preprocessing: Literal["yunet-2023mar-max960-minifasnet-2.7-bgr-0-255-nchw-80-v1"]
    pad_output: Literal["logits-1x3-live-index-1"]
    validation_report_filename: str = Field(pattern=r"^[a-zA-Z0-9_.-]+$")
    validation_report_sha256: str = Field(pattern="^[0-9a-f]{64}$")
    commercial_use_review_ref: str = Field(min_length=8, max_length=500)
    validated_attacks: list[str]

    def assert_usable(self) -> None:
        if self.model_id != MODEL_ID or self.model_sha256 != MODEL_SHA256 or self.detector_sha256 != ARTIFACTS["yunet"]["sha256"]:
            raise ValueError("calibration_model_mismatch")
        expiry = datetime.fromisoformat(self.valid_until.replace("Z", "+00:00"))
        if expiry.tzinfo is None or expiry <= datetime.now(timezone.utc):
            raise ValueError("calibration_expired")
        if not {"printed_photo", "screen_photo", "screen_video"}.issubset(set(self.validated_attacks)):
            raise ValueError("calibration_attack_tests_required")
        if settings.max_inference_dimension != 960 or settings.min_face_score != 0.85 or settings.min_quality_score != 0.65:
            raise ValueError("calibration_pipeline_mismatch")


class CalibrationRuntime:
    def __init__(self) -> None:
        self.record: CalibrationRecord | None = None
        self.pad: MiniFasNetPad | None = None
        self.reason = "calibration_required"

    @property
    def ready(self) -> bool:
        if self.record is None or self.pad is None:
            return False
        try:
            self.record.assert_usable()
            return True
        except ValueError:
            self.reason = "calibration_invalid_or_expired"
            return False

    def load(self) -> None:
        path = settings.calibration_path
        if not path or not settings.calibration_sha256:
            return
        try:
            if path.stat().st_size > 32_000 or file_sha256(path) != settings.calibration_sha256:
                raise ValueError("calibration_integrity_failed")
            record = CalibrationRecord.model_validate_json(path.read_bytes())
            record.assert_usable()
            directory = path.resolve().parent
            report = directory / record.validation_report_filename
            model = directory / record.pad_filename
            if model.resolve().parent != directory or report.resolve().parent != directory:
                raise ValueError("calibration_invalid_path")
            if model.stat().st_size > 20_000_000 or file_sha256(model) != record.pad_sha256:
                raise ValueError("pad_integrity_failed")
            if report.stat().st_size > 20_000_000 or file_sha256(report) != record.validation_report_sha256:
                raise ValueError("calibration_report_integrity_failed")
            import onnxruntime as ort
            options = ort.SessionOptions()
            options.intra_op_num_threads = settings.cpu_threads
            options.inter_op_num_threads = 1
            session = ort.InferenceSession(str(model), sess_options=options, providers=["CPUExecutionProvider"])
            inputs, outputs = session.get_inputs(), session.get_outputs()
            if (len(inputs) != 1 or inputs[0].shape != [1, 3, 80, 80] or inputs[0].type != "tensor(float)"
                    or len(outputs) != 1 or outputs[0].shape != [1, 3] or outputs[0].type != "tensor(float)"):
                raise ValueError("pad_model_contract_mismatch")
            self.record, self.pad, self.reason = record, MiniFasNetPad(session), "ready"
        except Exception:
            self.record, self.pad, self.reason = None, None, "calibration_or_pad_invalid"


calibration = CalibrationRuntime()
