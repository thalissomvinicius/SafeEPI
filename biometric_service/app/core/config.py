from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    service_token: str = Field(min_length=32)
    insightface_model: str = "buffalo_l"
    det_size: int = 640
    min_face_score: float = 0.55
    base_similarity_threshold: float = 0.40
    live_threshold: float = 0.80
    session_ttl_seconds: int = 45
    max_frame_bytes: int = 900_000
    max_sessions: int = Field(default=1_000, ge=10, le=50_000)

    model_config = SettingsConfigDict(env_prefix="SAFE_EPI_BIOMETRIC_")


settings = Settings()
