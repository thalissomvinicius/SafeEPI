from __future__ import annotations

import ctypes
import sys
import uuid
from ctypes import wintypes
from dataclasses import dataclass


WINBIO_TYPE_FINGERPRINT = 0x00000008
WINBIO_POOL_PRIVATE = 2
WINBIO_FLAG_BASIC = 0x00000001
WINBIO_ID_TYPE_GUID = 2
WINBIO_ANSI_381_POS_RH_INDEX_FINGER = 2
WINBIO_I_MORE_DATA = 0x00090001
WINBIO_E_UNKNOWN_ID = 0x80098003
WINBIO_E_NO_MATCH = 0x80098005
WINBIO_E_BAD_CAPTURE = 0x80098008
WINBIO_E_DEVICE_BUSY = 0x80098010
WINBIO_E_DATABASE_CANT_OPEN = 0x80098012
WINBIO_E_DUPLICATE_ENROLLMENT = 0x8009801C

SAFE_EPI_DATABASE_ID = uuid.UUID("e5975b98-141f-4d9c-bb5a-d1f62a1dfa44")


def _unsigned_hresult(value: int) -> int:
    return value & 0xFFFFFFFF


def describe_hresult(value: int) -> str:
    code = _unsigned_hresult(value)
    messages = {
        WINBIO_E_UNKNOWN_ID: "Digital não cadastrada neste terminal.",
        WINBIO_E_NO_MATCH: "Digital não cadastrada neste terminal.",
        WINBIO_E_BAD_CAPTURE: "Leitura ruim. Posicione o dedo novamente.",
        WINBIO_E_DEVICE_BUSY: "O leitor está ocupado. Aguarde e tente novamente.",
        WINBIO_E_DATABASE_CANT_OPEN: "Banco biométrico local indisponível. Execute o instalador como administrador.",
        WINBIO_E_DUPLICATE_ENROLLMENT: "Esta digital já está cadastrada.",
    }
    return messages.get(code, f"Falha biométrica do Windows (0x{code:08X}).")


class Guid(ctypes.Structure):
    _fields_ = [
        ("Data1", wintypes.DWORD),
        ("Data2", wintypes.WORD),
        ("Data3", wintypes.WORD),
        ("Data4", ctypes.c_ubyte * 8),
    ]

    @classmethod
    def from_uuid(cls, value: uuid.UUID) -> "Guid":
        fields = value.fields
        node_bytes = fields[5].to_bytes(6, "big")
        data4 = (ctypes.c_ubyte * 8)(fields[3], fields[4], *node_bytes)
        return cls(fields[0], fields[1], fields[2], data4)

    def to_uuid(self) -> uuid.UUID:
        node = int.from_bytes(bytes(self.Data4[2:]), "big")
        return uuid.UUID(fields=(self.Data1, self.Data2, self.Data3, self.Data4[0], self.Data4[1], node))


class _AccountSid(ctypes.Structure):
    _fields_ = [("Size", wintypes.ULONG), ("Data", ctypes.c_ubyte * 68)]


class _IdentityValue(ctypes.Union):
    _fields_ = [
        ("Null", wintypes.ULONG),
        ("Wildcard", wintypes.ULONG),
        ("TemplateGuid", Guid),
        ("AccountSid", _AccountSid),
    ]


class WinBioIdentity(ctypes.Structure):
    _anonymous_ = ("Value",)
    _fields_ = [("Type", wintypes.ULONG), ("Value", _IdentityValue)]

    @classmethod
    def for_template(cls, template_id: uuid.UUID) -> "WinBioIdentity":
        result = cls()
        result.Type = WINBIO_ID_TYPE_GUID
        result.TemplateGuid = Guid.from_uuid(template_id)
        return result


class _WinBioVersion(ctypes.Structure):
    _fields_ = [("MajorVersion", wintypes.DWORD), ("MinorVersion", wintypes.DWORD)]


class _WinBioUnitSchema(ctypes.Structure):
    _fields_ = [
        ("UnitId", wintypes.ULONG),
        ("PoolType", wintypes.ULONG),
        ("BiometricFactor", wintypes.ULONG),
        ("SensorSubType", wintypes.ULONG),
        ("Capabilities", wintypes.ULONG),
        ("DeviceInstanceId", wintypes.WCHAR * 256),
        ("Description", wintypes.WCHAR * 256),
        ("Manufacturer", wintypes.WCHAR * 256),
        ("Model", wintypes.WCHAR * 256),
        ("SerialNumber", wintypes.WCHAR * 256),
        ("FirmwareVersion", _WinBioVersion),
    ]


@dataclass(frozen=True, slots=True)
class BiometricUnit:
    unit_id: int
    device_instance_id: str
    description: str


@dataclass(frozen=True, slots=True)
class EnrollmentResult:
    unit_id: int
    template_id: uuid.UUID


class WinBioError(RuntimeError):
    def __init__(self, hresult: int, reject_detail: int | None = None) -> None:
        self.hresult = _unsigned_hresult(hresult)
        self.reject_detail = reject_detail
        super().__init__(describe_hresult(self.hresult))


class WinBioClient:
    def __init__(self, database_id: uuid.UUID = SAFE_EPI_DATABASE_ID) -> None:
        if sys.platform != "win32":
            raise RuntimeError("O leitor biométrico SafeEPI requer Windows.")
        self.database_id = database_id
        self._dll = ctypes.WinDLL("winbio.dll", use_last_error=True)
        self._configure_signatures()

    def _configure_signatures(self) -> None:
        self._dll.WinBioEnumBiometricUnits.argtypes = [
            wintypes.ULONG,
            ctypes.POINTER(ctypes.POINTER(_WinBioUnitSchema)),
            ctypes.POINTER(ctypes.c_size_t),
        ]
        self._dll.WinBioEnumBiometricUnits.restype = ctypes.c_long
        self._dll.WinBioFree.argtypes = [ctypes.c_void_p]
        self._dll.WinBioOpenSession.argtypes = [
            wintypes.ULONG,
            wintypes.ULONG,
            wintypes.ULONG,
            ctypes.POINTER(wintypes.ULONG),
            ctypes.c_size_t,
            ctypes.POINTER(Guid),
            ctypes.POINTER(ctypes.c_void_p),
        ]
        self._dll.WinBioOpenSession.restype = ctypes.c_long
        self._dll.WinBioCloseSession.argtypes = [ctypes.c_void_p]
        self._dll.WinBioCloseSession.restype = ctypes.c_long
        self._dll.WinBioEnrollBegin.argtypes = [ctypes.c_void_p, ctypes.c_ubyte, wintypes.ULONG]
        self._dll.WinBioEnrollBegin.restype = ctypes.c_long
        self._dll.WinBioEnrollCapture.argtypes = [ctypes.c_void_p, ctypes.POINTER(wintypes.ULONG)]
        self._dll.WinBioEnrollCapture.restype = ctypes.c_long
        self._dll.WinBioEnrollCommit.argtypes = [
            ctypes.c_void_p,
            ctypes.POINTER(WinBioIdentity),
            ctypes.POINTER(wintypes.BOOL),
        ]
        self._dll.WinBioEnrollCommit.restype = ctypes.c_long
        self._dll.WinBioEnrollDiscard.argtypes = [ctypes.c_void_p]
        self._dll.WinBioEnrollDiscard.restype = ctypes.c_long
        self._dll.WinBioVerify.argtypes = [
            ctypes.c_void_p,
            ctypes.POINTER(WinBioIdentity),
            ctypes.c_ubyte,
            ctypes.POINTER(wintypes.ULONG),
            ctypes.POINTER(wintypes.BOOL),
            ctypes.POINTER(wintypes.ULONG),
        ]
        self._dll.WinBioVerify.restype = ctypes.c_long
        self._dll.WinBioDeleteTemplate.argtypes = [
            ctypes.c_void_p,
            wintypes.ULONG,
            ctypes.POINTER(WinBioIdentity),
            ctypes.c_ubyte,
        ]
        self._dll.WinBioDeleteTemplate.restype = ctypes.c_long

    @staticmethod
    def _check(hr: int, reject_detail: int | None = None) -> None:
        if hr < 0:
            raise WinBioError(hr, reject_detail)

    def units(self) -> list[BiometricUnit]:
        schemas = ctypes.POINTER(_WinBioUnitSchema)()
        count = ctypes.c_size_t()
        hr = self._dll.WinBioEnumBiometricUnits(WINBIO_TYPE_FINGERPRINT, ctypes.byref(schemas), ctypes.byref(count))
        self._check(hr)
        try:
            return [
                BiometricUnit(
                    unit_id=int(schemas[index].UnitId),
                    device_instance_id=str(schemas[index].DeviceInstanceId),
                    description=str(schemas[index].Description),
                )
                for index in range(count.value)
            ]
        finally:
            if schemas:
                self._dll.WinBioFree(schemas)

    def _open_private_session(self, unit_id: int) -> ctypes.c_void_p:
        unit_array = (wintypes.ULONG * 1)(unit_id)
        database = Guid.from_uuid(self.database_id)
        session = ctypes.c_void_p()
        hr = self._dll.WinBioOpenSession(
            WINBIO_TYPE_FINGERPRINT,
            WINBIO_POOL_PRIVATE,
            WINBIO_FLAG_BASIC,
            unit_array,
            1,
            ctypes.byref(database),
            ctypes.byref(session),
        )
        self._check(hr)
        return session

    def enroll(self, unit_id: int, max_captures: int = 12) -> EnrollmentResult:
        session = self._open_private_session(unit_id)
        committed = False
        try:
            self._check(self._dll.WinBioEnrollBegin(session, WINBIO_ANSI_381_POS_RH_INDEX_FINGER, unit_id))
            for _ in range(max_captures):
                reject = wintypes.ULONG()
                hr = self._dll.WinBioEnrollCapture(session, ctypes.byref(reject))
                unsigned = _unsigned_hresult(hr)
                if unsigned == WINBIO_I_MORE_DATA or unsigned == WINBIO_E_BAD_CAPTURE:
                    continue
                self._check(hr, int(reject.value))
                identity = WinBioIdentity()
                is_new = wintypes.BOOL()
                self._check(self._dll.WinBioEnrollCommit(session, ctypes.byref(identity), ctypes.byref(is_new)))
                if identity.Type != WINBIO_ID_TYPE_GUID:
                    raise RuntimeError("O Windows não retornou uma identidade GUID para a digital cadastrada.")
                committed = True
                return EnrollmentResult(unit_id=unit_id, template_id=identity.TemplateGuid.to_uuid())
            raise WinBioError(WINBIO_E_BAD_CAPTURE)
        finally:
            if not committed:
                self._dll.WinBioEnrollDiscard(session)
            self._dll.WinBioCloseSession(session)

    def verify(self, template_id: uuid.UUID, unit_id: int) -> int:
        session = self._open_private_session(unit_id)
        try:
            identity = WinBioIdentity.for_template(template_id)
            used_unit = wintypes.ULONG()
            matched = wintypes.BOOL()
            reject = wintypes.ULONG()
            hr = self._dll.WinBioVerify(
                session,
                ctypes.byref(identity),
                WINBIO_ANSI_381_POS_RH_INDEX_FINGER,
                ctypes.byref(used_unit),
                ctypes.byref(matched),
                ctypes.byref(reject),
            )
            self._check(hr, int(reject.value))
            if not matched.value:
                raise WinBioError(WINBIO_E_NO_MATCH, int(reject.value))
            return int(used_unit.value or unit_id)
        finally:
            self._dll.WinBioCloseSession(session)

    def delete(self, template_id: uuid.UUID, unit_id: int) -> int:
        session = self._open_private_session(unit_id)
        try:
            identity = WinBioIdentity.for_template(template_id)
            self._check(
                self._dll.WinBioDeleteTemplate(
                    session,
                    unit_id,
                    ctypes.byref(identity),
                    WINBIO_ANSI_381_POS_RH_INDEX_FINGER,
                )
            )
            return unit_id
        finally:
            self._dll.WinBioCloseSession(session)
