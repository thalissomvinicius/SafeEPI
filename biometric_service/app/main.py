from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routes.biometric import router as biometric_router

app = FastAPI(title="SafeEPI Biometric Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[],
    allow_credentials=False,
    allow_methods=["POST", "GET"],
    allow_headers=["Authorization", "Content-Type"],
)

app.include_router(biometric_router, prefix="/biometric", tags=["biometric"])


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
