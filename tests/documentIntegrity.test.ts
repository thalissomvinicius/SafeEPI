import { describe, expect, it } from "vitest"
import {
  assertPdfBytes,
  calculateSha256,
  parsePdfDataUrl,
} from "@/lib/documentIntegrity"

const encoder = new TextEncoder()

describe("documentIntegrity", () => {
  it("calcula SHA-256 no servidor a partir dos bytes reais", async () => {
    const hash = await calculateSha256(encoder.encode("SafeEPI"))

    expect(hash).toBe("0b52d03e6c6a405a4c02c7cf9a1651600c434953fd336bc0a92dc4f5e46647f3")
  })

  it("aceita somente arquivo iniciado pelo cabeçalho PDF", () => {
    expect(() => assertPdfBytes(encoder.encode("%PDF-1.7\nconteudo"))).not.toThrow()
    expect(() => assertPdfBytes(encoder.encode("<script>alert(1)</script>"))).toThrow("PDF invalido")
  })

  it("rejeita PDF vazio ou acima do limite", () => {
    expect(() => assertPdfBytes(new Uint8Array())).toThrow("PDF vazio")
    expect(() => assertPdfBytes(new Uint8Array(11), 10)).toThrow("excede")
  })

  it("decodifica data URL PDF sem confiar no tipo enviado separadamente", () => {
    const encoded = Buffer.from("%PDF-1.7\nSafeEPI").toString("base64")
    const bytes = parsePdfDataUrl(`data:application/pdf;base64,${encoded}`)

    expect(new TextDecoder().decode(bytes)).toContain("%PDF-1.7")
  })

  it("rejeita data URL que não seja PDF base64", () => {
    expect(() => parsePdfDataUrl("data:text/html;base64,SGVsbG8=")).toThrow("Data URL PDF invalida")
  })
})
