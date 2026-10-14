export type RequiredGeolocationResult =
  | { ok: true; value: string; source: "device" | "network"; accuracyMeters?: number }
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

function requestDeviceGeolocation(): Promise<RequiredGeolocationResult> {
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const value = `${position.coords.latitude.toFixed(6)}, ${position.coords.longitude.toFixed(6)}`
        if (!isValidGeoLocation(value)) {
          resolve({ ok: false, reason: "unavailable", message: "O dispositivo não retornou coordenadas válidas. Tente novamente." })
          return
        }
        resolve({
          ok: true,
          value,
          source: "device",
          accuracyMeters: Number.isFinite(position.coords.accuracy) ? Math.round(position.coords.accuracy) : undefined,
        })
      },
      (error) => resolve(resolveGeolocationError(error)),
      // A recent reading responds faster on desktops without dedicated GPS.
      { enableHighAccuracy: false, timeout: 6000, maximumAge: 5 * 60 * 1000 },
    )
  })
}

async function requestNetworkGeolocation(): Promise<RequiredGeolocationResult | null> {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), 5000)
  try {
    const response = await fetch("/api/client-location", { cache: "no-store", credentials: "same-origin", signal: controller.signal })
    if (!response.ok) return null
    const data = await response.json() as { location?: unknown; source?: unknown }
    const value = typeof data.location === "string" ? data.location.trim() : ""
    if (data.source !== "network" || !isValidGeoLocation(value)) return null
    // Approximate provider-derived network location is not device GPS evidence.
    return { ok: true, value, source: "network" }
  } catch {
    return null
  } finally {
    window.clearTimeout(timeoutId)
  }
}

export async function requestRequiredGeolocation(): Promise<RequiredGeolocationResult> {
  const unsupported: RequiredGeolocationResult = {
    ok: false,
    reason: "unsupported",
    message: "Este navegador não oferece localização. Use um navegador com localização habilitada.",
  }
  const deviceResult = typeof navigator === "undefined" || !navigator.geolocation
    ? unsupported
    : await requestDeviceGeolocation()
  if (deviceResult.ok) return deviceResult
  if (typeof window !== "undefined") {
    const networkResult = await requestNetworkGeolocation()
    if (networkResult) return networkResult
  }
  return deviceResult
}
