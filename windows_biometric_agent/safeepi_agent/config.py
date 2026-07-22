from __future__ import annotations

import json
import os
import uuid
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from .security import ProtectedTokenStore, SecurityError, WindowsDpapiProtector, normalize_server_url
from .identity_store import BiometricIdentityStore


DEFAULT_SERVER_URL = "https://safe-epi.vercel.app"


def default_data_dir() -> Path:
    local_app_data = os.environ.get("LOCALAPPDATA")
    if not local_app_data:
        raise SecurityError("LOCALAPPDATA não está disponível.")
    return Path(local_app_data) / "SafeEPI" / "FingerprintAgent"


@dataclass(slots=True)
class TerminalConfig:
    server_url: str
    device_id: str
    terminal_id: str | None = None
    company_id: str | None = None
    terminal_name: str | None = None
    poll_interval_seconds: int = 2

    @classmethod
    def new(cls, server_url: str = DEFAULT_SERVER_URL) -> "TerminalConfig":
        return cls(server_url=normalize_server_url(server_url), device_id=str(uuid.uuid4()))

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "TerminalConfig":
        config = cls(
            server_url=normalize_server_url(str(payload.get("server_url") or DEFAULT_SERVER_URL)),
            device_id=str(uuid.UUID(str(payload.get("device_id")))),
            terminal_id=str(uuid.UUID(str(payload["terminal_id"]))) if payload.get("terminal_id") else None,
            company_id=str(uuid.UUID(str(payload["company_id"]))) if payload.get("company_id") else None,
            terminal_name=str(payload["terminal_name"])[:80] if payload.get("terminal_name") else None,
            poll_interval_seconds=max(1, min(15, int(payload.get("poll_interval_seconds", 2)))),
        )
        return config


class ConfigRepository:
    def __init__(self, data_dir: Path | None = None) -> None:
        self.data_dir = data_dir or default_data_dir()
        self.config_path = self.data_dir / "config.json"
        self.token_path = self.data_dir / "terminal-token.dpapi"
        self.identity_path = self.data_dir / "biometric-identities.dpapi"
        protector = WindowsDpapiProtector()
        self.token_store = ProtectedTokenStore(
            protector=protector,
            read_bytes=self._read_token,
            write_bytes=self._write_token,
        )
        self.identity_store = BiometricIdentityStore(
            protector=protector,
            read_bytes=self._read_identity,
            write_bytes=self._write_identity,
        )

    def _ensure_dir(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)

    def _read_token(self) -> bytes | None:
        return self.token_path.read_bytes() if self.token_path.exists() else None

    def _write_token(self, value: bytes) -> None:
        self._ensure_dir()
        self.token_path.write_bytes(value)

    def _read_identity(self) -> bytes | None:
        return self.identity_path.read_bytes() if self.identity_path.exists() else None

    def _write_identity(self, value: bytes) -> None:
        self._ensure_dir()
        temporary_path = self.identity_path.with_suffix(".tmp")
        temporary_path.write_bytes(value)
        temporary_path.replace(self.identity_path)

    def load(self) -> TerminalConfig:
        if not self.config_path.exists():
            config = TerminalConfig.new(os.environ.get("SAFEEPI_SERVER_URL", DEFAULT_SERVER_URL))
            self.save(config)
            return config
        try:
            payload = json.loads(self.config_path.read_text(encoding="utf-8"))
            if not isinstance(payload, dict):
                raise ValueError("invalid config")
            return TerminalConfig.from_dict(payload)
        except (OSError, ValueError, TypeError, json.JSONDecodeError) as error:
            raise SecurityError("Configuração local do terminal inválida.") from error

    def save(self, config: TerminalConfig) -> None:
        self._ensure_dir()
        safe_payload = asdict(config)
        self.config_path.write_text(json.dumps(safe_payload, indent=2, ensure_ascii=False), encoding="utf-8")

    def load_token(self) -> str | None:
        return self.token_store.load()

    def save_token(self, token: str) -> None:
        self.token_store.save(token)

    def clear_terminal_token(self) -> None:
        if self.token_path.exists():
            self.token_path.unlink()
