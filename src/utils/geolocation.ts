export type RequiredGeolocationResult =
  | { ok: true; value: string }
  | { ok: false; reason: "unsupported" | "denied" | "timeout" | "unavailable" | "unknown"; message: string }

const COORDINATE_PATTERN = /^(-?\d{1,2}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)$/

export function isValidGeoLocation(value?: string | null) {
  if (!value) return false

  const normalized = value.trim().toLowerCase()
  if (
    !normalized ||
    normalized.includes("permiss") ||
    normalized.includes("negad") ||
    normalized.includes("sem suporte") ||
    normalized.includes("nao captur") ||
    normalized.includes("não captur") ||
    normalized.includes("indispon")
  ) {
    return false
  }

  const match = value.trim().match(COORDINATE_PATTERN)
  if (!match) return false

  const latitude = Number(match[1])
  const longitude = Number(match[2])
  return Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
}

function resolveGeolocationError(error: GeolocationPositionError): RequiredGeolocationResult {
  if (error.code === error.PERMISSION_DENIED) {
    return {
      ok: false,
      reason: "denied",
      message: "Permita a localização do navegador para concluir a assinatura e gerar o PDF auditável.",
    }
  }

  if (error.code === error.TIMEOUT) {
    return {
      ok: false,
      reason: "timeout",
      message: "Não conseguimos capturar a localização a tempo. Verifique o sinal/GPS e tente novamente.",
    }
  }

  if (error.code === error.POSITION_UNAVAILABLE) {
    return {
      ok: false,
      reason: "unavailable",
      message: "A localização não está disponível neste dispositivo. Ative o GPS e tente novamente.",
    }
  }

  return {
    ok: false,
    reason: "unknown",
    message: "Não foi possível capturar a localização. Libere a permissão e tente novamente.",
  }
}

export function requestRequiredGeolocation(): Promise<RequiredGeolocationResult> {
  if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
    return Promise.resolve({
      ok: false,
      reason: "unsupported",
      message: "Este navegador não oferece localização. Use um navegador com GPS/localização habilitada.",
    })
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const value = `${position.coords.latitude.toFixed(6)}, ${position.coords.longitude.toFixed(6)}`
        resolve({ ok: true, value })
      },
      (error) => resolve(resolveGeolocationError(error)),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    )
  })
}
