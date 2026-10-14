from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from secrets import compare_digest
import anyio
from starlette.responses import JSONResponse

from app.routes.biometric import router as biometric_router
from app.routes.v2 import router as v2_router
from app.core.config import settings
from app.model_manifest import MODEL_ID, MODEL_SHA256
from app.services.face_engine import face_engine
from app.services.calibration import calibration


@asynccontextmanager
async def lifespan(app):
    try:
        face_engine.load()
    except RuntimeError:
        pass  # Readiness exposes a safe reason; enrollment returns 503, never a dummy.
    calibration.load()
    yield


app = FastAPI(title="SafeEPI Biometric Service", version="2.0.0", lifespan=lifespan)


class BoundedAuthenticatedBody:
    """Reject unauthorized and oversize bodies before multipart spooling/parsing."""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] != "POST":
            return await self.app(scope, receive, send)
        headers = dict(scope["headers"])
        expected = f"Bearer {settings.service_token}".encode("utf-8")
        if not compare_digest(headers.get(b"authorization", b""), expected):
            return await JSONResponse({"detail": "unauthorized"}, status_code=401)(scope, receive, send)
        limit = settings.max_frame_bytes + 32_000
        try:
            claimed_size = int(headers.get(b"content-length", b"0"))
        except ValueError:
            return await JSONResponse({"detail": "invalid_content_length"}, status_code=400)(scope, receive, send)
        if claimed_size < 0 or claimed_size > limit:
            return await JSONResponse({"detail": "frame_too_large"}, status_code=413)(scope, receive, send)
        body = bytearray()
        try:
            with anyio.fail_after(10):
                while True:
                    message = await receive()
                    if message["type"] == "http.disconnect":
                        return
                    body.extend(message.get("body", b""))
                    if len(body) > limit:
                        return await JSONResponse({"detail": "frame_too_large"}, status_code=413)(scope, receive, send)
                    if not message.get("more_body", False):
                        break
        except TimeoutError:
            return await JSONResponse({"detail": "upload_timeout"}, status_code=408)(scope, receive, send)
        delivered = False

        async def bounded_receive():
            nonlocal delivered
            if not delivered:
                delivered = True
                return {"type": "http.request", "body": bytes(body), "more_body": False}
            return await receive()

        await self.app(scope, bounded_receive, send)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[],
    allow_credentials=False,
    allow_methods=["POST", "GET"],
    allow_headers=["Authorization", "Content-Type"],
)
app.add_middleware(BoundedAuthenticatedBody)

app.include_router(biometric_router, prefix="/biometric", tags=["biometric"])
app.include_router(v2_router, prefix="/v2", tags=["biometric-v2"])


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "protocol_version": 2, "model_id": MODEL_ID,
            "model_sha256": MODEL_SHA256, "enrollment_ready": face_engine.ready,
            "verification_ready": face_engine.ready and calibration.ready,
            "face_reason": face_engine.readiness_reason, "pad_reason": calibration.reason,
            "calibration_id": calibration.record.calibration_id if calibration.ready else None}
