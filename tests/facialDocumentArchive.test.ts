// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

const m = vi.hoisted(() => ({ remove: vi.fn(), download: vi.fn(), from: vi.fn() }))
const companyId = "11111111-1111-4111-8111-111111111111"
vi.mock("@/lib/supabaseAdmin", () => ({ supabaseAdmin: {
  auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "operator" } }, error: null }) },
  storage: { from: () => ({ download: m.download, remove: m.remove }) }, from: m.from,
} }))
vi.mock("@/lib/serverAuth", () => ({ requireAuthorizedUser: vi.fn().mockResolvedValue({
  authorized: true, user: { id: "operator", role: "ADMIN", company_id: "11111111-1111-4111-8111-111111111111" },
}) }))
vi.mock("@/lib/privateStorage", () => ({ PRIVATE_STORAGE_BUCKET: "ppe_signatures", STORAGE_VIEW_EXPIRES_IN: 60,
  signStorageValue: vi.fn(), getSignedUrl: vi.fn(),
}))
vi.mock("@/lib/rateLimit", () => ({ rateLimit: vi.fn().mockResolvedValue({ success: false, retryAfter: 3600 }), rateLimitExceededResponse: () => new Response(null, { status: 429 }) }))

beforeEach(() => {
  vi.clearAllMocks()
  m.download.mockResolvedValue({ data: new Blob(["%PDF-1.7\nexisting-document\n%%EOF"]), error: null })
  m.remove.mockResolvedValue({ error: null })
})

describe("arquivo PDF nunca apaga arquivo anterior ao rejeitar requisicao", () => {
  it("preserva PDF pre-enviado quando hash declarado e incorreto", async () => {
    const form = new FormData()
    form.set("document_type", "return")
    form.set("storage_path", `signed-documents/${companyId}/return/existing.pdf`)
    form.set("sha256_hash", "0".repeat(64))
    const { POST } = await import("@/app/api/signed-documents/route")
    const response = await POST(new Request("http://localhost/api/signed-documents", {
      method: "POST", headers: { Authorization: "Bearer test-session" }, body: form,
    }))
    expect(response.status).toBe(400)
    expect(m.remove).not.toHaveBeenCalled()
  })
})
