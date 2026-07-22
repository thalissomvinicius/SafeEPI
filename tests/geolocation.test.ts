import { afterEach, describe, expect, it, vi } from "vitest"

import { isValidGeoLocation, requestRequiredGeolocation } from "@/utils/geolocation"

const originalGeolocation = navigator.geolocation

afterEach(() => {
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: originalGeolocation })
  vi.restoreAllMocks()
})

describe("geolocation", () => {
  it("valida limites reais de latitude e longitude", () => {
    expect(isValidGeoLocation("-23.550520, -46.633308")).toBe(true)
    expect(isValidGeoLocation("91, -46")).toBe(false)
    expect(isValidGeoLocation("permissão negada")).toBe(false)
  })

  it("usa a posição do dispositivo quando disponível", async () => {
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: (success: PositionCallback) => success({
          coords: { latitude: -23.55052, longitude: -46.633308, accuracy: 18 },
        } as GeolocationPosition),
      },
    })

    await expect(requestRequiredGeolocation()).resolves.toEqual({
      ok: true,
      value: "-23.550520, -46.633308",
      source: "device",
      accuracyMeters: 18,
    })
  })

  it("usa a posição aproximada da rede quando o navegador nega o GPS", async () => {
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: (_success: PositionCallback, error: PositionErrorCallback) => error({
          code: 1,
          PERMISSION_DENIED: 1,
          POSITION_UNAVAILABLE: 2,
          TIMEOUT: 3,
          message: "denied",
        } as GeolocationPositionError),
      },
    })
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ location: "-23.5505, -46.6333", source: "network" }),
    }))

    await expect(requestRequiredGeolocation()).resolves.toEqual({
      ok: true,
      value: "-23.5505, -46.6333",
      source: "network",
    })
  })
})
