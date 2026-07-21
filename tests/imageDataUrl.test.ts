import { afterEach, describe, expect, it, vi } from "vitest"
import { fetchImageDataUrl } from "@/utils/imageDataUrl"

describe("fetchImageDataUrl", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("recusa gerar documento silenciosamente quando uma assinatura esperada expirou", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("expired", { status: 403 })))

    await expect(fetchImageDataUrl("https://example.test/signature", {
      required: true,
      label: "a assinatura da entrega",
    })).rejects.toThrow("HTTP 403")
  })

  it("mantem imagens opcionais como fallback nulo", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")))

    await expect(fetchImageDataUrl("https://example.test/photo")).resolves.toBeNull()
  })
})
