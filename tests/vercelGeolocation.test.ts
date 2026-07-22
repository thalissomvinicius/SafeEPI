import { describe, expect, it } from "vitest"

import { getVercelNetworkGeolocation } from "@/lib/vercelGeolocation"

describe("getVercelNetworkGeolocation", () => {
  it("lê coordenadas válidas dos cabeçalhos da Vercel", () => {
    const request = new Request("https://safe-epi.vercel.app/api/client-location", {
      headers: {
        "x-vercel-ip-latitude": "-23.5505",
        "x-vercel-ip-longitude": "-46.6333",
      },
    })

    expect(getVercelNetworkGeolocation(request)).toEqual({
      value: "-23.5505, -46.6333",
      source: "network",
    })
  })

  it("rejeita cabeçalhos ausentes ou fora dos limites", () => {
    expect(getVercelNetworkGeolocation(new Request("https://safe-epi.vercel.app"))).toBeNull()
    expect(getVercelNetworkGeolocation(new Request("https://safe-epi.vercel.app", {
      headers: {
        "x-vercel-ip-latitude": "999",
        "x-vercel-ip-longitude": "-46",
      },
    }))).toBeNull()
  })
})
