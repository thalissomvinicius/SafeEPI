from typing import Literal
from pydantic import BaseModel, Field


BiometricDecision = Literal["pending", "approved", "retry", "fallback", "rejected"]
BiometricState = Literal[
    "INIT",
    "WAIT_FACE",
    "QUALITY_CHECK",
    "CENTER",
    "TURN_LEFT",
    "TURN_RIGHT",
    "MOVE_NEAR",
    "MOVE_FAR",
    "BLINK",
    "VERIFYING",
    "APPROVED",
    "RETRY",
    "FALLBACK_REQUIRED",
    "REJECTED",
]


class ScoreBundle(BaseModel):
    similarity: float | None = None
    spoof: float
    quality: float
    consistency: float
    challenge: float
    context: float
    final: float


class StartSessionResponse(BaseModel):
    session_id: str
    state: BiometricState
    decision: BiometricDecision
    instruction: str
    progress: int = Field(ge=0, le=100)
    challenge_sequence: list[str]
    frame_interval_ms: int


class FrameResponse(BaseModel):
    session_id: str
    state: BiometricState
    decision: BiometricDecision
    instruction: str
    progress: int = Field(ge=0, le=100)
    frame_interval_ms: int
    reason: str | None = None
    embedding: list[float] | None = None
    scores: ScoreBundle
    audit: dict[str, str | float | int | bool | None] = {}
