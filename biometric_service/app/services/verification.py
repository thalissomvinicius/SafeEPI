"""Pure decision policy. No quality/challenge score can compensate a failed gate."""
import math
from app.model_manifest import MODEL_ID

EMBEDDING_DIM = 128


def validate_embedding(values: object) -> list[float]:
    if not isinstance(values, list) or len(values) != EMBEDDING_DIM:
        raise ValueError("invalid_embedding")
    if any(isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or abs(value) > 1.001 for value in values):
        raise ValueError("invalid_embedding")
    norm = math.sqrt(sum(value * value for value in values))
    if norm < 1e-8:
        raise ValueError("invalid_embedding")
    return [float(value / norm) for value in values]


def verification_decision(*, similarity: float, threshold: float | None, calibration_id: str | None,
                          pad_score: float | None, pad_threshold: float | None,
                          pad_model_id: str | None) -> tuple[str, str]:
    if (not calibration_id or threshold is None or not math.isfinite(threshold)
            or not 0 < threshold <= 1):
        return "unavailable", "calibration_required"
    if (not pad_model_id or pad_score is None or pad_threshold is None
            or not math.isfinite(pad_score) or not math.isfinite(pad_threshold)
            or not 0 <= pad_score <= 1 or not 0 < pad_threshold <= 1):
        return "unavailable", "pad_not_validated"
    if not math.isfinite(similarity) or not -1 <= similarity <= 1:
        return "unavailable", "invalid_similarity"
    if pad_score < pad_threshold:
        return "rejected", "presentation_attack_suspected"
    if similarity < threshold:
        return "rejected", "identity_mismatch"
    return "approved", "identity_verified"
