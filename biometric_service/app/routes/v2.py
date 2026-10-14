import json
from threading import BoundedSemaphore
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from starlette.concurrency import run_in_threadpool

from app.core.config import settings
from app.core.security import require_service_token
from app.model_manifest import MODEL_ID, MODEL_SHA256
from app.services.calibration import calibration
from app.services.face_engine import face_engine, cosine_similarity
from app.services.image import decode_image
from app.services.verification import validate_embedding, verification_decision

router = APIRouter(dependencies=[Depends(require_service_token)])
inference_slots = BoundedSemaphore(settings.max_concurrent_inferences)


async def read_frame(frame: UploadFile) -> bytes:
    try:
        if frame.content_type not in {"image/jpeg", "image/png"}:
            raise HTTPException(status_code=415, detail="unsupported_image_format")
        content = await frame.read(settings.max_frame_bytes + 1)
        if len(content) > settings.max_frame_bytes:
            raise HTTPException(status_code=413, detail="frame_too_large")
        return content
    finally:
        await frame.close()


def analyze(content: bytes) -> tuple:
    try:
        image = decode_image(content)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    try:
        return image, face_engine.analyze(image)
    except Exception as error:
        # Never expose filesystem paths, model internals, templates or decoder errors.
        raise HTTPException(status_code=503, detail="face_engine_unavailable") from error


async def bounded_inference(operation, *args):
    if not inference_slots.acquire(blocking=False):
        raise HTTPException(status_code=503, detail="biometric_capacity_reached", headers={"Retry-After": "2"})
    try:
        return await run_in_threadpool(operation, *args)
    finally:
        inference_slots.release()


def enroll_image(content: bytes) -> dict:
    _, result = analyze(content)
    if not result["ok"]:
        raise HTTPException(status_code=422, detail=result["reason"])
    return {"embedding": validate_embedding(result["embedding"]), "model_id": MODEL_ID,
            "model_sha256": MODEL_SHA256, "quality": result["quality_score"]}


@router.post("/enroll")
async def enroll(frame: UploadFile = File(...)) -> dict:
    return await bounded_inference(enroll_image, await read_frame(frame))


def verify_image(content: bytes, reference: list[float]) -> dict:
    response = {"decision": "unavailable", "reason": calibration.reason,
                "model_id": MODEL_ID, "model_sha256": MODEL_SHA256,
                "similarity": None, "threshold": None, "pad_score": None,
                "pad_threshold": None, "pad_model_id": None, "calibration_id": None, "quality": None}
    # Fast unavailable response: no expensive inference or biometric processing
    # when this deployment cannot authorize verification.
    if not calibration.ready:
        response["reason"] = calibration.reason
        return response
    record = calibration.record
    response.update(threshold=record.similarity_threshold, pad_threshold=record.pad_threshold,
                    pad_model_id=record.pad_model_id, calibration_id=record.calibration_id)
    image, result = analyze(content)
    response["quality"] = result.get("quality_score")
    if not result["ok"]:
        response.update(decision="rejected", reason=result["reason"])
        return response
    try:
        similarity = cosine_similarity(reference, result["embedding"])
        pad_score = calibration.pad.score(image, result["bbox"])
        decision, reason = verification_decision(similarity=similarity, threshold=record.similarity_threshold,
            calibration_id=record.calibration_id, pad_score=pad_score,
            pad_threshold=record.pad_threshold, pad_model_id=record.pad_model_id)
        response.update(decision=decision, reason=reason, similarity=similarity, pad_score=pad_score)
    except Exception:
        response.update(decision="unavailable", reason="pad_inference_unavailable")
    return response


@router.post("/verify")
async def verify(frame: UploadFile = File(...), reference_embedding: str = Form(...), reference_model_id: str = Form(...)) -> dict:
    if reference_model_id != MODEL_ID:
        raise HTTPException(status_code=422, detail="reference_model_mismatch_reenroll_required")
    try:
        if len(reference_embedding) > 10_000:
            raise ValueError("invalid_embedding")
        reference = validate_embedding(json.loads(reference_embedding))
    except (ValueError, TypeError) as error:
        raise HTTPException(status_code=422, detail="invalid_reference_embedding") from error
    return await bounded_inference(verify_image, await read_frame(frame), reference)
