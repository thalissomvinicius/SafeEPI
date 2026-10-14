from dataclasses import dataclass

from app.schemas import ScoreBundle


@dataclass
class RiskDecision:
    decision: str
    reason: str | None
    instruction: str
    scores: ScoreBundle


def adaptive_similarity_threshold(quality: float, spoof: float, has_ppe: bool = False) -> float:
    # Legacy heuristic retired. V2 uses an artifact-bound calibration record.
    raise RuntimeError("biometric_protocol_retired_use_v2")


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

    return RiskDecision("fallback", "legacy_protocol_retired", "Use assinatura manual ou o protocolo facial v2", scores)
