from pathlib import Path
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    service_token: str = Field(min_length=32)
    models_dir: Path = Path(__file__).resolve().parents[2] / "models"
    calibration_path: Path | None = None
    calibration_sha256: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    min_face_score: float = Field(default=0.85, ge=0.5, le=1)
    min_quality_score: float = Field(default=0.65, ge=0.55, le=1)
    max_inference_dimension: int = Field(default=960, ge=320, le=1280)
    max_image_pixels: int = Field(default=8_000_000, ge=100_000, le=16_000_000)
    cpu_threads: int = Field(default=2, ge=1, le=8)
    max_concurrent_inferences: int = Field(default=1, ge=1, le=4)
    session_ttl_seconds: int = 45
    max_frame_bytes: int = Field(default=2_000_000, ge=100_000, le=4_000_000)
    max_sessions: int = Field(default=1_000, ge=10, le=50_000)

    model_config = SettingsConfigDict(env_prefix="SAFE_EPI_BIOMETRIC_", hide_input_in_errors=True)


settings = Settings()
