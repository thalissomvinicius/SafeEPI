// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"
import { MANUAL_ACCEPTANCE_VERSION } from "@/lib/manualSignatureEvidence"
const m = vi.hoisted(() => ({ from: vi.fn(), download: vi.fn(), remove: vi.fn(), inserted: {} as Record<string, unknown>, previous: null as Record<string, unknown> | null, duplicate: false }))
const companyId = "11111111-1111-4111-8111-111111111111"
vi.mock("@/lib/supabaseAdmin", () => ({ supabaseAdmin: {
  auth: { getUser: async () => ({ data: { user: { id: "operator" } } }) },
  storage: { from: () => ({ download: m.download, remove: m.remove }) }, from: m.from,
} }))
vi.mock("@/lib/serverAuth", () => ({ requireAuthorizedUser: async () => ({ authorized: true, user: { id: "operator", role: "ADMIN", company_id: "11111111-1111-4111-8111-111111111111" } }) }))
vi.mock("@/lib/privateStorage", () => ({ PRIVATE_STORAGE_BUCKET: "ppe_signatures", STORAGE_VIEW_EXPIRES_IN: 60, signStorageValue: async (v: unknown) => v, getSignedUrl: vi.fn() }))
import { POST } from "@/app/api/signed-documents/route"
function request(metadata: unknown = {}) {
  const form = new FormData()
  form.set("document_type", "return")
  form.set("storage_path", `signed-documents/${companyId}/return/previous.pdf`)
  form.set("metadata", JSON.stringify(metadata))
  return new Request("http://localhost/api/signed-documents", { method: "POST", headers: { Authorization: "Bearer fixture", "x-vercel-forwarded-for": "192.0.2.10" }, body: form })
}
beforeEach(() => {
  vi.clearAllMocks(); m.duplicate = false; m.previous = null
  m.download.mockResolvedValue({ data: new Blob(["%PDF-1.7\nfixture\n%%EOF"]), error: null })
  m.remove.mockResolvedValue({ error: null })
  m.from.mockImplementation(() => {
    const chain = {
      select: () => chain, eq: () => chain,
      insert: (payload: Record<string, unknown>[]) => { m.inserted = payload[0]; return chain },
      single: async () => m.duplicate ? { data: null, error: { code: "23505" } } : { data: { ...m.inserted, id: "archive-id" }, error: null },
      maybeSingle: async () => ({ data: m.previous, error: null }),
    }
    return chain
  })
})
describe("metadados do arquivo reconstruídos no servidor", () => {
  it("não aceita recibo/identidade inventados pelo cliente", async () => {
    const response = await POST(request({ archivalReceipt: { server_received_at: "2000-01-01" }, manualSignatureEvidence: { identity_verified: true }, manualSignatureDeclaration: { origin: "typed", accepted: true, termVersion: MANUAL_ACCEPTANCE_VERSION } }))
    expect(response.status).toBe(200)
    const metadata = m.inserted.metadata as Record<string, Record<string, unknown>>
    expect(metadata.manualSignatureEvidence.identity_verified).toBe(false)
    expect(metadata.manualSignatureEvidence.term_sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(metadata.archivalReceipt.event).toBe("pdf_archival_not_delivery_acceptance")
    expect(metadata.archivalReceipt.server_received_at).not.toBe("2000-01-01")
    expect(metadata).not.toHaveProperty("manualSignatureDeclaration")
    expect(m.inserted.ip_address).toBe("192.0.2.10")
  })
  it("rejeita versão adulterada sem apagar PDF preexistente", async () => {
    expect((await POST(request({ manualSignatureDeclaration: { origin: "drawn", accepted: true, termVersion: "fake" } }))).status).toBe(400)
    expect(m.remove).not.toHaveBeenCalled()
  })
  it("recupera arquivamento já concluído com o mesmo hash e vínculo", async () => {
    m.duplicate = true
    m.previous = { id: "original", document_type: "return", employee_id: null, delivery_ids: [], company_id: companyId }
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect((await response.json()).document.id).toBe("original")
  })
  it("não recupera PDF com vínculo diferente", async () => {
    m.duplicate = true
    m.previous = { id: "foreign", document_type: "return", employee_id: "other", delivery_ids: [], company_id: companyId }
    expect((await POST(request())).status).toBe(400)
  })
})
