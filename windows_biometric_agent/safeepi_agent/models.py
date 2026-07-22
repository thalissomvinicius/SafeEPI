from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Literal
from uuid import UUID


Operation = Literal["enroll", "verify", "delete"]
SUPPORTED_OPERATIONS: set[str] = {"enroll", "verify", "delete"}


class ProtocolError(ValueError):
    """Raised when the cloud sends a malformed or unsupported command."""


def _parse_uuid(value: Any, field: str) -> UUID:
    try:
        return UUID(str(value))
    except (TypeError, ValueError, AttributeError) as error:
        raise ProtocolError(f"{field} inválido") from error


def _parse_timestamp(value: Any) -> datetime:
    if not isinstance(value, str) or not value:
        raise ProtocolError("expires_at inválido")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise ProtocolError("expires_at inválido") from error
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


@dataclass(frozen=True, slots=True)
class FingerprintCommand:
    id: UUID
    operation: Operation
    employee_id: UUID
    employee_name: str
    expires_at: datetime

    @classmethod
    def from_payload(cls, payload: dict[str, Any]) -> "FingerprintCommand":
        if not isinstance(payload, dict):
            raise ProtocolError("comando inválido")

        operation = payload.get("operation")
        if operation not in SUPPORTED_OPERATIONS:
            raise ProtocolError("operação não permitida")

        employee_name = str(payload.get("employee_name") or "").strip()
        if not employee_name or len(employee_name) > 180:
            raise ProtocolError("employee_name inválido")

        command = cls(
            id=_parse_uuid(payload.get("id"), "id"),
            operation=operation,
            employee_id=_parse_uuid(payload.get("employee_id"), "employee_id"),
            employee_name=employee_name,
            expires_at=_parse_timestamp(payload.get("expires_at")),
        )
        if command.is_expired():
            raise ProtocolError("comando expirado")
        return command

    def is_expired(self, now: datetime | None = None) -> bool:
        current = now or datetime.now(timezone.utc)
        if current.tzinfo is None:
            current = current.replace(tzinfo=timezone.utc)
        return current.astimezone(timezone.utc) >= self.expires_at

    def result_payload(
        self,
        *,
        success: bool,
        unit_id: int | None = None,
        error_code: str | None = None,
        reject_detail: int | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "success": bool(success),
            "unit_id": int(unit_id) if unit_id is not None else None,
            "error_code": error_code[:80] if error_code else None,
            "reject_detail": int(reject_detail) if reject_detail is not None else None,
        }
        if self.operation == "verify" and success:
            payload["matched_employee_id"] = str(self.employee_id)
        return payload
