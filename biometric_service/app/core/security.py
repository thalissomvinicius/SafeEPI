from fastapi import Header, HTTPException

from app.core.config import settings


def require_service_token(authorization: str | None = Header(default=None)) -> None:
    expected = f"Bearer {settings.service_token}"
    if authorization != expected:
        raise HTTPException(status_code=401, detail="unauthorized")
