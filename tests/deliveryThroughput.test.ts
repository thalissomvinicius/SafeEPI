// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const m = vi.hoisted(() => ({ auth: vi.fn(), limit: vi.fn(), upload: vi.fn(), target: vi.fn(), from: vi.fn() }))
const company = "11111111-1111-4111-8111-111111111111"
const employee = "22222222-2222-4222-8222-222222222222"
vi.mock("@/lib/serverAuth", () => ({ requireAuthorizedUser: m.auth }))
vi.mock("@/lib/rateLimit", () => ({ rateLimit: m.limit, rateLimitExceededResponse: () => new Response(null, { status: 429 }) }))
vi.mock("@/lib/supabaseAdmin", () => ({ supabaseAdmin: { from: m.from, storage: { from: () => ({ upload: m.upload, createSignedUploadUrl: m.target }) } } }))
vi.mock("@/lib/privateStorage", () => ({ PRIVATE_STORAGE_BUCKET: "ppe_signatures", STORAGE_VIEW_EXPIRES_IN: 60, getSignedUrl: async () => ({ signedUrl: "https://example.org/signature" }), signStorageValue: async () => null }))
vi.mock("@/lib/validateUpload", () => ({ validateUpload: async () => ({ extension: "png", contentType: "image/png", buffer: new Uint8Array([1]) }) }))

beforeEach(() => {
  vi.clearAllMocks()
  m.auth.mockResolvedValue({ authorized: true, user: { id: "operator", role: "ADMIN", company_id: company } })
  // Simulate an IP/company whose old hourly allowance is already exhausted.
  m.limit.mockResolvedValue({ success: false, retryAfter: 3600 })
  m.upload.mockResolvedValue({ error: null })
  m.target.mockResolvedValue({ data: { token: "upload-token", signedUrl: "https://example.org/upload" }, error: null })
  m.from.mockImplementation((table: string) => {
    const query: Record<string, unknown> = {}
    for (const op of ["update", "eq", "in", "insert", "select"]) query[op] = () => query
    query.single = async () => ({ data: { id: "link", employee_id: employee, company_id: company }, error: null })
    query.maybeSingle = async () => ({ data: table === "companies" ? { id: company, active: true, subscription_status: "ACTIVE" } : { id: employee, company_id: company, active: true }, error: null })
    query.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: table === "ppes" ? [{ id: "33333333-3333-4333-8333-333333333333", company_id: company, active: true, name: "EPI teste" }] : null, error: null }).then(resolve)
    return query
  })
})
function formRequest(path: string, form: FormData) {
  return new Request(`https://safeepi.example${path}`, { method: "POST", headers: { "x-forwarded-for": "192.0.2.10" }, body: form })
}

describe("entregas não têm cota por hora", () => {
  it("permite 30 uploads de assinatura no mesmo IP e mantém exigência de login", async () => {
    const { POST } = await import("@/app/api/signature-upload/route")
    for (let i = 0; i < 30; i++) {
      const form = new FormData()
      form.set("signatureFile", new File(["synthetic"], "sig.png", { type: "image/png" }))
      form.set("employee_id", employee)
      expect((await POST(formRequest("/api/signature-upload", form))).status).toBe(200)
    }
    expect(m.limit).not.toHaveBeenCalled()
    m.auth.mockResolvedValue({ authorized: false, response: new Response(null, { status: 401 }) })
    expect((await POST(formRequest("/api/signature-upload", new FormData()))).status).toBe(401)
    expect(m.upload).toHaveBeenCalledTimes(30)
  })

  it("prepara 30 PDFs de EPI mesmo com a cota antiga esgotada", async () => {
    const { POST } = await import("@/app/api/signed-documents/upload-url/route")
    for (let i = 0; i < 30; i++) {
      const form = new FormData()
      form.set("document_type", "delivery")
      form.set("employee_id", employee)
      form.set("file_name", "entrega.pdf")
      expect((await POST(formRequest("/api/signed-documents/upload-url", form))).status).toBe(200)
    }
    expect(m.limit).not.toHaveBeenCalled()
  })

  it("permite 30 links de entrega e preserva a política dos outros tipos", async () => {
    const { POST } = await import("@/app/api/remote-links/route")
    const request = (type: string) => new NextRequest("https://safeepi.example/api/remote-links", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ employee_id: employee, type, data: { p: "33333333-3333-4333-8333-333333333333", q: 1 } }) })
    for (let i = 0; i < 30; i++) expect((await POST(request("delivery"))).status).toBe(200)
    expect(m.limit).not.toHaveBeenCalled()
    expect((await POST(request("capture"))).status).toBe(429)
  })
})
