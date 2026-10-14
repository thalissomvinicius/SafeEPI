"""Retired protocol: cannot approve legacy 512-dimensional templates."""
from fastapi import APIRouter, Depends, HTTPException
from app.core.security import require_service_token

router = APIRouter(dependencies=[Depends(require_service_token)])


@router.post("/session/start")
@router.post("/session/frame")
@router.post("/enroll")
def retired_protocol() -> None:
    raise HTTPException(status_code=410, detail="biometric_protocol_retired_use_v2")
