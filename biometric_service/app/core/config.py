from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    service_token: str = "dev-safeepi-biometric-token"
    insightface_model: str = "buffalo_l"
    det_size: int = 640
    min_face_score: float = 0.55
    base_similarity_threshold: float = 0.40
    live_threshold: float = 0.80
    session_ttl_seconds: int = 45
    max_frame_bytes: int = 900_000

    class Config:
        env_prefix = "SAFE_EPI_BIOMETRIC_"


settings = Settings()
