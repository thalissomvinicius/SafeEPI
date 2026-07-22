from __future__ import annotations

import json
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Callable

from .models import FingerprintCommand, ProtocolError
from .security import normalize_server_url


class AgentApiError(RuntimeError):
    def __init__(self, message: str, status: int | None = None) -> None:
        self.status = status
        super().__init__(message)


Transport = Callable[[urllib.request.Request, float], tuple[int, bytes]]


def _default_transport(request: urllib.request.Request, timeout: float) -> tuple[int, bytes]:
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return int(response.status), response.read()
    except urllib.error.HTTPError as error:
        return int(error.code), error.read()
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        raise AgentApiError("Não foi possível conectar ao SafeEPI.") from error


@dataclass(slots=True)
class PairingResult:
    terminal_id: str
    company_id: str
    terminal_name: str
    terminal_token: str
    poll_interval_seconds: int


class AgentApi:
    def __init__(self, server_url: str, transport: Transport = _default_transport) -> None:
        self.server_url = normalize_server_url(server_url)
        self._transport = transport

    def _request(
        self,
        method: str,
        path: str,
        *,
        token: str | None = None,
        payload: dict[str, Any] | None = None,
        timeout: float = 15.0,
    ) -> dict[str, Any]:
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8") if payload is not None else None
        headers = {"Accept": "application/json", "User-Agent": "SafeEPI-Fingerprint-Agent/0.1"}
        if body is not None:
            headers["Content-Type"] = "application/json"
        if token:
            headers["Authorization"] = f"Bearer {token}"
        request = urllib.request.Request(f"{self.server_url}{path}", data=body, headers=headers, method=method)
        status, raw = self._transport(request, timeout)
        try:
            response = json.loads(raw.decode("utf-8")) if raw else {}
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise AgentApiError("O SafeEPI retornou uma resposta inválida.", status) from error
        if not isinstance(response, dict):
            raise AgentApiError("O SafeEPI retornou uma resposta inválida.", status)
        if status < 200 or status >= 300:
            message = response.get("error")
            raise AgentApiError(str(message) if message else "A solicitação foi recusada pelo SafeEPI.", status)
        return response

    def pair(self, payload: dict[str, Any]) -> PairingResult:
        response = self._request("POST", "/api/fingerprint/agent/pair", payload=payload)
        try:
            return PairingResult(
                terminal_id=str(response["terminal_id"]),
                company_id=str(response["company_id"]),
                terminal_name=str(response["terminal_name"]),
                terminal_token=str(response["terminal_token"]),
                poll_interval_seconds=max(1, min(15, int(response.get("poll_interval_seconds", 2)))),
            )
        except (KeyError, TypeError, ValueError) as error:
            raise AgentApiError("Pareamento retornou dados incompletos.") from error

    def next_command(self, token: str) -> FingerprintCommand | None:
        response = self._request("GET", "/api/fingerprint/agent/commands", token=token, timeout=10.0)
        payload = response.get("command")
        if payload is None:
            return None
        try:
            return FingerprintCommand.from_payload(payload)
        except ProtocolError as error:
            raise AgentApiError(f"Comando inválido recebido: {error}") from error

    def complete(self, token: str, command: FingerprintCommand, result: dict[str, Any]) -> dict[str, Any]:
        return self._request(
            "POST",
            f"/api/fingerprint/agent/commands/{command.id}/complete",
            token=token,
            payload=result,
            timeout=15.0,
        )
