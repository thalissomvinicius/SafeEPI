from dataclasses import dataclass

from app.core.config import settings
from app.schemas import ScoreBundle


@dataclass
class RiskDecision:
    decision: str
    reason: str | None
    instruction: str
    scores: ScoreBundle


def adaptive_similarity_threshold(quality: float, spoof: float, has_ppe: bool = False) -> float:
    if has_ppe:
        return 0.36
    if quality >= 0.78 and spoof >= 0.9:
        return 0.45
    if quality < 0.55:
        return 0.38
    return settings.base_similarity_threshold


def resolve_weights(challenge_required: bool, quality: float) -> dict[str, float]:
    if not challenge_required:
        return {
            "spoof": 0.34,
            "similarity": 0.42,
            "consistency": 0.14,
            "quality": 0.06,
            "challenge": 0.00,
            "context": 0.04,
        }
    if quality < 0.55:
        return {
            "spoof": 0.30,
            "similarity": 0.34,
            "consistency": 0.20,
            "quality": 0.06,
            "challenge": 0.06,
            "context": 0.04,
        }
    return {
        "spoof": 0.32,
        "similarity": 0.36,
        "consistency": 0.14,
        "quality": 0.06,
        "challenge": 0.08,
        "context": 0.04,
    }


def decide(
    *,
    similarity: float | None,
    spoof: float,
    quality: float,
    consistency: float,
    challenge: float,
    context: float,
    challenge_required: bool,
) -> RiskDecision:
    weights = resolve_weights(challenge_required, quality)
    similarity_score = similarity if similarity is not None else 0.0
    final = (
        spoof * weights["spoof"]
        + similarity_score * weights["similarity"]
        + consistency * weights["consistency"]
        + quality * weights["quality"]
        + challenge * weights["challenge"]
        + context * weights["context"]
    )

    scores = ScoreBundle(
        similarity=similarity,
        spoof=spoof,
        quality=quality,
        consistency=consistency,
        challenge=challenge,
        context=context,
        final=final,
    )

    if final >= 0.82:
        return RiskDecision("approved", None, "Identidade confirmada", scores)
    if final >= 0.70:
        return RiskDecision("retry", "medium_risk", "Vamos tentar mais uma vez com o rosto bem centralizado", scores)
    return RiskDecision("fallback", "high_risk", "Use assinatura manual com registro auditavel", scores)
