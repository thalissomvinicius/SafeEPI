import { describe, expect, it } from "vitest"
import { MANUAL_ACCEPTANCE_VERSION, getManualSignatureDeclaration, parseManualSignatureDeclaration, setManualSignatureDeclaration } from "@/lib/manualSignatureEvidence"
import { buildManualSignatureArchive } from "@/lib/manualSignatureArchive"

describe("declaração manual sem alegação biométrica", () => {
  it("não inventa evidência para assinaturas antigas", () => {
    expect(getManualSignatureDeclaration({})).toBeNull()
    expect(parseManualSignatureDeclaration({ accepted: true })).toBeNull()
  })
  it("mantém cópia da origem e permite limpar", () => {
    const pad = {}, declaration = { origin: "typed" as const, accepted: false }
    setManualSignatureDeclaration(pad, declaration)
    declaration.accepted = true
    expect(getManualSignatureDeclaration(pad)?.accepted).toBe(false)
    setManualSignatureDeclaration(pad, null)
    expect(getManualSignatureDeclaration(pad)).toBeNull()
  })
  it("rejeita aceite de versão desconhecida", async () => {
    await expect(buildManualSignatureArchive({ origin: "drawn", accepted: true, termVersion: "alterado" })).rejects.toThrow()
  })
  it("reconstrói termo e hash e não aceita alegação de identidade ou horário", async () => {
    const result = await buildManualSignatureArchive({ origin: "typed", accepted: true, termVersion: MANUAL_ACCEPTANCE_VERSION, identity_verified: true, term_text: "falso", accepted_at: "2000-01-01" })
    expect(result.identity_verified).toBe(false)
    expect(result.source).toBe("browser_declaration")
    expect(result.term_sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(result.term_text).not.toBe("falso")
    expect(result).not.toHaveProperty("accepted_at")
  })
})
