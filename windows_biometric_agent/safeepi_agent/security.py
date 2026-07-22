from __future__ import annotations

import ctypes
from ctypes import wintypes
from dataclasses import dataclass
from typing import Callable, Protocol
from urllib.parse import urlparse


class SecurityError(RuntimeError):
    """Raised when protected terminal configuration cannot be trusted."""


def normalize_server_url(value: str) -> str:
    raw = (value or "").strip().rstrip("/")
    parsed = urlparse(raw)
    is_loopback = parsed.hostname in {"127.0.0.1", "localhost", "::1"}
    if parsed.scheme != "https" and not (parsed.scheme == "http" and is_loopback):
        raise SecurityError("O endereço do SafeEPI deve usar HTTPS.")
    if not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise SecurityError("Endereço do SafeEPI inválido.")
    return raw


class Protector(Protocol):
    def protect(self, value: bytes) -> bytes: ...
    def unprotect(self, value: bytes) -> bytes: ...


@dataclass(slots=True)
class ProtectedTokenStore:
    protector: Protector
    read_bytes: Callable[[], bytes | None]
    write_bytes: Callable[[bytes], None]

    def save(self, token: str) -> None:
        if not token or len(token) < 32:
            raise SecurityError("Token do terminal inválido.")
        protected = self.protector.protect(token.encode("utf-8"))
        if not protected or token.encode("utf-8") in protected:
            raise SecurityError("O token não foi protegido corretamente.")
        self.write_bytes(protected)

    def load(self) -> str | None:
        protected = self.read_bytes()
        if not protected:
            return None
        try:
            token = self.protector.unprotect(protected).decode("utf-8")
        except (UnicodeDecodeError, OSError, ValueError) as error:
            raise SecurityError("Não foi possível abrir a credencial protegida do terminal.") from error
        if len(token) < 32:
            raise SecurityError("Credencial protegida inválida.")
        return token


class _DataBlob(ctypes.Structure):
    _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_byte))]


class WindowsDpapiProtector:
    """Protects the terminal bearer token for the current Windows account."""

    _CRYPTPROTECT_UI_FORBIDDEN = 0x1

    def __init__(self) -> None:
        if not hasattr(ctypes, "windll"):
            raise SecurityError("DPAPI está disponível somente no Windows.")
        self._crypt32 = ctypes.windll.crypt32
        self._kernel32 = ctypes.windll.kernel32
        self._crypt32.CryptProtectData.argtypes = [
            ctypes.POINTER(_DataBlob),
            wintypes.LPCWSTR,
            ctypes.POINTER(_DataBlob),
            ctypes.c_void_p,
            ctypes.c_void_p,
            wintypes.DWORD,
            ctypes.POINTER(_DataBlob),
        ]
        self._crypt32.CryptProtectData.restype = wintypes.BOOL
        self._crypt32.CryptUnprotectData.argtypes = [
            ctypes.POINTER(_DataBlob),
            ctypes.POINTER(wintypes.LPWSTR),
            ctypes.POINTER(_DataBlob),
            ctypes.c_void_p,
            ctypes.c_void_p,
            wintypes.DWORD,
            ctypes.POINTER(_DataBlob),
        ]
        self._crypt32.CryptUnprotectData.restype = wintypes.BOOL
        self._kernel32.LocalFree.argtypes = [ctypes.c_void_p]
        self._kernel32.LocalFree.restype = ctypes.c_void_p

    @staticmethod
    def _blob(value: bytes) -> tuple[_DataBlob, ctypes.Array[ctypes.c_char]]:
        buffer = ctypes.create_string_buffer(value)
        blob = _DataBlob(len(value), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_byte)))
        return blob, buffer

    def protect(self, value: bytes) -> bytes:
        source, source_buffer = self._blob(value)
        _ = source_buffer
        output = _DataBlob()
        ok = self._crypt32.CryptProtectData(
            ctypes.byref(source),
            "SafeEPI Fingerprint Terminal",
            None,
            None,
            None,
            self._CRYPTPROTECT_UI_FORBIDDEN,
            ctypes.byref(output),
        )
        if not ok:
            raise ctypes.WinError()
        try:
            return ctypes.string_at(output.pbData, output.cbData)
        finally:
            self._kernel32.LocalFree(output.pbData)

    def unprotect(self, value: bytes) -> bytes:
        source, source_buffer = self._blob(value)
        _ = source_buffer
        output = _DataBlob()
        ok = self._crypt32.CryptUnprotectData(
            ctypes.byref(source), None, None, None, None, self._CRYPTPROTECT_UI_FORBIDDEN, ctypes.byref(output)
        )
        if not ok:
            raise ctypes.WinError()
        try:
            return ctypes.string_at(output.pbData, output.cbData)
        finally:
            self._kernel32.LocalFree(output.pbData)
