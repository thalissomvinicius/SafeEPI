import time
import uuid
from dataclasses import dataclass, field
from typing import Literal
import random

import numpy as np

from app.core.config import settings

SessionMode = Literal["enroll", "verify", "evidence"]


@dataclass
class BiometricSession:
    id: str
    mode: SessionMode
    employee_id: str | None
    company_id: str | None
    challenge_sequence: list[str]
    created_at: float = field(default_factory=time.time)
    state_index: int = 0
    valid_frames: int = 0
    embeddings: list[list[float]] = field(default_factory=list)
    frame_hashes: set[str] = field(default_factory=set)
    challenge_hits: int = 0
    baseline_face_ratio: float | None = None

    @property
    def current_challenge(self) -> str:
        if self.state_index >= len(self.challenge_sequence):
            return "VERIFYING"
        return self.challenge_sequence[self.state_index]

    def expired(self) -> bool:
        return time.time() - self.created_at > settings.session_ttl_seconds

    def add_embedding(self, embedding: list[float]) -> float:
        self.embeddings.append(embedding)
        if len(self.embeddings) > 6:
            self.embeddings.pop(0)
        return self.consistency()

    def consistency(self) -> float:
        if len(self.embeddings) < 2:
            return 0.86
        vectors = [np.asarray(item, dtype=np.float32) for item in self.embeddings]
        centroid = np.mean(vectors, axis=0)
        sims = []
        for vector in vectors:
            denom = float(np.linalg.norm(vector) * np.linalg.norm(centroid))
            sims.append(float(np.dot(vector, centroid) / denom) if denom else 0.0)
        return max(0.0, min(1.0, float(np.mean(sims))))

    def challenge_completion(self) -> float:
        if not self.challenge_sequence:
            return 1.0
        return max(0.0, min(1.0, self.state_index / len(self.challenge_sequence)))

    def advance_challenge(self) -> None:
        self.state_index += 1
        self.challenge_hits = 0


class SessionStore:
    def __init__(self) -> None:
        self.sessions: dict[str, BiometricSession] = {}

    def create(
        self,
        mode: SessionMode,
        employee_id: str | None,
        company_id: str | None,
        require_liveness: bool = False,
    ) -> BiometricSession:
        sequence = ["CENTER"]
        if mode == "verify" and require_liveness:
            # Active liveness adaptativo: um desafio natural por sessao.
            # Blink/smile ficam como plug-in quando houver landmark model denso
            # habilitado no ambiente; evitamos desafios instaveis em campo.
            sequence.append(random.choice(["TURN_LEFT", "TURN_RIGHT", "MOVE_NEAR"]))
        session = BiometricSession(
            id=str(uuid.uuid4()),
            mode=mode,
            employee_id=employee_id,
            company_id=company_id,
            challenge_sequence=sequence,
        )
        self.sessions[session.id] = session
        return session

    def get(self, session_id: str) -> BiometricSession | None:
        session = self.sessions.get(session_id)
        if not session:
            return None
        if session.expired():
            self.sessions.pop(session_id, None)
            return None
        return session


session_store = SessionStore()
