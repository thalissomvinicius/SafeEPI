from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from app.core.config import settings
from app.core.security import require_service_token
from app.schemas import FrameResponse, ScoreBundle, StartSessionResponse
from app.services.antispoof import antispoof
from app.services.face_engine import face_engine, cosine_similarity
from app.services.image import decode_image, image_sha256
from app.services.quality import instruction_for_quality
from app.services.risk import adaptive_similarity_threshold, decide
from app.services.session_store import session_store

router = APIRouter(dependencies=[Depends(require_service_token)])

CHALLENGE_INSTRUCTIONS = {
    "CENTER": "Centralize o rosto e olhe para a camera",
    "TURN_LEFT": "Vire levemente o rosto para a esquerda",
    "TURN_RIGHT": "Vire levemente o rosto para a direita",
    "MOVE_NEAR": "Aproxime um pouco o rosto",
    "MOVE_FAR": "Afaste um pouco o rosto",
    "VERIFYING": "Validando identidade...",
}


def face_ratio(bbox: list[float], image_shape: tuple[int, int, int]) -> float:
    height, width = image_shape[:2]
    if height <= 0 or width <= 0:
        return 0.0
    x1, y1, x2, y2 = bbox
    return max(0.0, ((x2 - x1) * (y2 - y1)) / (width * height))


def yaw_ratio(landmarks: list[list[float]]) -> float | None:
    if len(landmarks) < 3:
        return None
    left_eye = landmarks[0]
    right_eye = landmarks[1]
    nose = landmarks[2]
    eye_distance = abs(right_eye[0] - left_eye[0])
    if eye_distance <= 1:
        return None
    eye_center = (left_eye[0] + right_eye[0]) / 2
    return (nose[0] - eye_center) / eye_distance


def challenge_feedback(session, analysis: dict, image_shape: tuple[int, int, int]) -> tuple[bool, str, int]:
    current = session.current_challenge
    ratio = face_ratio(analysis["bbox"], image_shape)
    if session.baseline_face_ratio is None and ratio > 0:
        session.baseline_face_ratio = ratio

    passed = False
    if current == "CENTER":
        center_score = float(analysis["quality_parts"].get("center", 0))
        face_size = float(analysis["quality_parts"].get("face_size", 0))
        passed = center_score >= 0.62 and face_size >= 0.42
    elif current == "TURN_LEFT":
        yaw = yaw_ratio(analysis.get("landmarks", []))
        passed = yaw is not None and yaw <= -0.12
    elif current == "TURN_RIGHT":
        yaw = yaw_ratio(analysis.get("landmarks", []))
        passed = yaw is not None and yaw >= 0.12
    elif current == "MOVE_NEAR":
        baseline = session.baseline_face_ratio or ratio
        passed = ratio >= baseline * 1.16
    elif current == "MOVE_FAR":
        baseline = session.baseline_face_ratio or ratio
        passed = ratio <= baseline * 0.86
    else:
        return True, CHALLENGE_INSTRUCTIONS["VERIFYING"], 85

    if passed:
        session.challenge_hits += 1
    else:
        session.challenge_hits = max(0, session.challenge_hits - 1)

    if session.challenge_hits >= 2:
        session.advance_challenge()
        if session.current_challenge == "VERIFYING":
            return True, CHALLENGE_INSTRUCTIONS["VERIFYING"], 85
        return False, CHALLENGE_INSTRUCTIONS.get(session.current_challenge, "Continue"), 45 + session.state_index * 20

    progress = 20 + session.challenge_completion() * 55 + min(session.challenge_hits, 2) * 8
    return False, CHALLENGE_INSTRUCTIONS.get(current, "Continue"), int(progress)


@router.post("/session/start", response_model=StartSessionResponse)
def start_session(
    mode: str = Form("verify"),
    employee_id: str | None = Form(None),
    company_id: str | None = Form(None),
    require_liveness: bool = Form(False),
) -> StartSessionResponse:
    if mode not in {"enroll", "verify", "evidence"}:
        raise HTTPException(status_code=400, detail="invalid_mode")
    try:
        session = session_store.create(mode, employee_id, company_id, require_liveness)  # type: ignore[arg-type]
    except RuntimeError as error:
        if "capacity" in str(error):
            raise HTTPException(status_code=503, detail="session_capacity_reached") from error
        raise
    return StartSessionResponse(
        session_id=session.id,
        state="WAIT_FACE",
        decision="pending",
        instruction=CHALLENGE_INSTRUCTIONS.get(session.current_challenge, "Centralize seu rosto"),
        progress=5,
        challenge_sequence=session.challenge_sequence,
        frame_interval_ms=500,
    )


@router.post("/session/frame", response_model=FrameResponse)
async def process_frame(
    session_id: str = Form(...),
    frame: UploadFile = File(...),
    reference_embedding: str | None = Form(None),
) -> FrameResponse:
    session = session_store.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="session_expired")

    image_bytes = await frame.read()
    if len(image_bytes) > settings.max_frame_bytes:
        raise HTTPException(status_code=413, detail="frame_too_large")
    frame_hash = image_sha256(image_bytes)
    if not session.accept_frame_hash(frame_hash):
        scores = ScoreBundle(spoof=0, quality=0, consistency=0, challenge=0, context=0, final=0)
        return FrameResponse(
            session_id=session.id,
            state="WAIT_FACE",
            decision="pending",
            instruction="A imagem nao mudou. Movimente o rosto e tente novamente",
            progress=10,
            frame_interval_ms=500,
            reason="duplicate_frame",
            scores=scores,
            audit={"frame_hash": frame_hash, "duplicate_frame": True},
        )
    image = decode_image(image_bytes)

    analysis = face_engine.analyze(image)
    if not analysis["ok"]:
        scores = ScoreBundle(spoof=0, quality=0, consistency=0, challenge=0, context=0.5, final=0)
        return FrameResponse(
            session_id=session.id,
            state="WAIT_FACE",
            decision="pending",
            instruction="Centralize apenas um rosto na camera",
            progress=10,
            frame_interval_ms=500,
            reason=analysis["reason"],
            scores=scores,
            audit={"frame_hash": frame_hash, "face_count": analysis.get("face_count", 0)},
        )

    quality = float(analysis["quality_score"])
    quality_reason, quality_instruction = instruction_for_quality(analysis["quality_parts"])
    embedding = analysis["embedding"]
    consistency = session.add_embedding(embedding)
    live_score = antispoof.score(image, analysis["bbox"], quality)
    duplicate_frame = False

    if quality_instruction:
        scores = ScoreBundle(spoof=live_score, quality=quality, consistency=consistency, challenge=0.2, context=0.6, final=quality)
        return FrameResponse(
            session_id=session.id,
            state="QUALITY_CHECK",
            decision="pending",
            instruction=quality_instruction,
            progress=25,
            frame_interval_ms=500,
            reason=quality_reason,
            scores=scores,
            audit={"frame_hash": frame_hash, "duplicate_frame": duplicate_frame},
        )

    challenge_done, next_instruction, challenge_progress = challenge_feedback(session, analysis, image.shape)
    challenge_score = session.challenge_completion()

    if not challenge_done:
        scores = ScoreBundle(spoof=live_score, quality=quality, consistency=consistency, challenge=challenge_score, context=0.7, final=0.5)
        return FrameResponse(
            session_id=session.id,
            state=session.current_challenge,  # type: ignore[arg-type]
            decision="pending",
            instruction=next_instruction,
            progress=challenge_progress,
            frame_interval_ms=250 if session.current_challenge != "CENTER" else 500,
            scores=scores,
            audit={"frame_hash": frame_hash, "duplicate_frame": duplicate_frame},
        )

    session.valid_frames += 1
    if session.valid_frames < 2:
        scores = ScoreBundle(spoof=live_score, quality=quality, consistency=consistency, challenge=1.0, context=0.7, final=0.65)
        return FrameResponse(
            session_id=session.id,
            state="VERIFYING",
            decision="pending",
            instruction="Conferindo os sinais finais...",
            progress=90,
            frame_interval_ms=333,
            scores=scores,
            audit={"frame_hash": frame_hash, "duplicate_frame": duplicate_frame},
        )

    similarity = None
    if reference_embedding:
        try:
            values = [float(item) for item in reference_embedding.split(",") if item]
            similarity = cosine_similarity(values, embedding)
        except Exception:
            similarity = None

    if session.mode == "enroll":
        similarity = 1.0

    # Sem embedding de referencia, a sessao aprova apenas cadastro/evidencia.
    if session.mode == "verify" and similarity is None:
        similarity = 0.0

    risk = decide(
        similarity=similarity,
        spoof=live_score,
        quality=quality,
        consistency=consistency,
        challenge=challenge_score,
        context=0.72,
        challenge_required=len(session.challenge_sequence) > 1,
    )

    state = "APPROVED" if risk.decision == "approved" else "RETRY" if risk.decision == "retry" else "FALLBACK_REQUIRED"
    threshold = adaptive_similarity_threshold(quality, live_score)
    if session.mode == "verify" and similarity is not None and similarity < threshold:
        risk.decision = "retry"
        risk.reason = "similarity_below_threshold"
        risk.instruction = "Rosto nao confirmado. Tente novamente em boa iluminacao"
        state = "RETRY"

    return FrameResponse(
        session_id=session.id,
        state=state,  # type: ignore[arg-type]
        decision=risk.decision,  # type: ignore[arg-type]
        instruction=risk.instruction,
        progress=100 if risk.decision == "approved" else 72,
        frame_interval_ms=0,
        reason=risk.reason,
        embedding=embedding if risk.decision == "approved" else None,
        scores=risk.scores,
        audit={
            "frame_hash": frame_hash,
            "duplicate_frame": duplicate_frame,
            "threshold": threshold,
            "det_score": analysis["det_score"],
        },
    )


@router.post("/enroll")
async def enroll(frame: UploadFile = File(...)) -> dict:
    image_bytes = await frame.read()
    if len(image_bytes) > settings.max_frame_bytes:
        raise HTTPException(status_code=413, detail="frame_too_large")
    image = decode_image(image_bytes)
    analysis = face_engine.analyze(image)
    if not analysis["ok"]:
        raise HTTPException(status_code=422, detail=analysis["reason"])
    return {
        "embedding": analysis["embedding"],
        "quality": analysis["quality_score"],
        "instruction": "Cadastro facial gerado",
    }
