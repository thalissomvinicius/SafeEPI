from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Callable
from uuid import UUID

from .security import Protector, SecurityError


@dataclass(frozen=True, slots=True)
class EnrollmentReference:
    template_id: UUID
    unit_id: int


class BiometricIdentityStore:
    """DPAPI-protected map between SafeEPI employees and opaque WBF template GUIDs."""

    def __init__(
        self,
        *,
        protector: Protector,
        read_bytes: Callable[[], bytes | None],
        write_bytes: Callable[[bytes], None],
        max_cached_commands: int = 100,
    ) -> None:
        self._protector = protector
        self._read_bytes = read_bytes
        self._write_bytes = write_bytes
        self._max_cached_commands = max(10, min(max_cached_commands, 500))

    def _load(self) -> dict[str, Any]:
        protected = self._read_bytes()
        if not protected:
            return {"version": 1, "employees": {}, "commands": {}}
        try:
            decoded = self._protector.unprotect(protected)
            state = json.loads(decoded.decode("utf-8"))
            if not isinstance(state, dict) or state.get("version") != 1:
                raise ValueError("invalid state")
            if not isinstance(state.get("employees"), dict) or not isinstance(state.get("commands"), dict):
                raise ValueError("invalid state")
            return state
        except (UnicodeDecodeError, json.JSONDecodeError, OSError, ValueError, TypeError) as error:
            raise SecurityError("Mapa local de identidades biométricas inválido.") from error

    def _save(self, state: dict[str, Any]) -> None:
        raw = json.dumps(state, ensure_ascii=True, separators=(",", ":")).encode("utf-8")
        protected = self._protector.protect(raw)
        if not protected or raw in protected:
            raise SecurityError("O mapa biométrico local não foi protegido corretamente.")
        self._write_bytes(protected)

    def get_enrollment(self, employee_id: UUID) -> EnrollmentReference | None:
        record = self._load()["employees"].get(str(employee_id))
        if not isinstance(record, dict):
            return None
        try:
            return EnrollmentReference(template_id=UUID(str(record["template_id"])), unit_id=int(record["unit_id"]))
        except (KeyError, TypeError, ValueError, AttributeError) as error:
            raise SecurityError("Referência biométrica local inválida.") from error

    def save_enrollment(self, employee_id: UUID, template_id: UUID, unit_id: int) -> None:
        state = self._load()
        state["employees"][str(employee_id)] = {
            "template_id": str(template_id),
            "unit_id": int(unit_id),
        }
        self._save(state)

    def remove_enrollment(self, employee_id: UUID) -> None:
        state = self._load()
        state["employees"].pop(str(employee_id), None)
        self._save(state)

    def get_command_result(self, command_id: UUID) -> dict[str, Any] | None:
        result = self._load()["commands"].get(str(command_id))
        return dict(result) if isinstance(result, dict) else None

    def cache_command_result(self, command_id: UUID, result: dict[str, Any]) -> None:
        state = self._load()
        commands: dict[str, Any] = state["commands"]
        commands[str(command_id)] = dict(result)
        while len(commands) > self._max_cached_commands:
            commands.pop(next(iter(commands)))
        self._save(state)
