import { afterEach, describe, expect, it, vi } from "vitest"
import { fetchImageDataUrl, imageDataUrlToFile } from "@/utils/imageDataUrl"

describe("imageDataUrlToFile", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("converte a assinatura localmente sem tentar acessar a rede", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    const file = imageDataUrlToFile("data:image/png;base64,AQIDBA==", "signature")

    expect(fetchMock).not.toHaveBeenCalled()
    expect(file.name).toBe("signature.png")
    expect(file.type).toBe("image/png")
    expect(Array.from(new Uint8Array(await file.arrayBuffer()))).toEqual([1, 2, 3, 4])
  })

  it("preserva a extensão de formatos de imagem permitidos", () => {
    expect(imageDataUrlToFile("data:image/jpeg;base64,AQ==", "signature").name).toBe("signature.jpg")
    expect(imageDataUrlToFile("data:image/webp;base64,AQ==", "signature").name).toBe("signature.webp")
  })

  it("recusa conteúdo vazio ou que não seja uma imagem Base64 permitida", () => {
    expect(() => imageDataUrlToFile("data:image/png;base64,", "signature")).toThrow("inválida")
    expect(() => imageDataUrlToFile("data:text/plain;base64,AQ==", "signature")).toThrow("inválida")
    expect(() => imageDataUrlToFile("data:image/svg+xml;base64,AQ==", "signature")).toThrow("inválida")
  })
})

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
