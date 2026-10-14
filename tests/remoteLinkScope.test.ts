// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mock = vi.hoisted(() => ({
  rows: {} as Record<string, Array<Record<string, unknown>>>,
  writes: [] as Array<{ table: string; kind: string; value: unknown }>,
  rpc: vi.fn(), upload: vi.fn(), remove: vi.fn(), auth: vi.fn(),
}))
vi.mock("@/lib/serverAuth", () => ({ requireAuthorizedUser: mock.auth }))
vi.mock("@/lib/rateLimit", () => ({ rateLimit: async () => ({ success: true }), rateLimitExceededResponse: () => new Response(null, { status: 429 }) }))
vi.mock("@/lib/privateStorage", () => ({ PRIVATE_STORAGE_BUCKET: "ppe_signatures", BIOMETRIC_BUCKET: "biometric_photos", signStorageValue: async (value: unknown) => value }))
vi.mock("@/lib/validateUpload", () => ({ validateUpload: async () => ({ extension: "png", contentType: "image/png", buffer: new Uint8Array([1]) }), validateUploadBuffer: () => ({ extension: "png", contentType: "image/png" }) }))
vi.mock("@/lib/supabaseAdmin", () => ({ getSupabaseAdminConfigError: () => null, supabaseAdmin: {
  rpc: mock.rpc, storage: { from: () => ({ upload: mock.upload, remove: mock.remove }) },
  from: (table: string) => {
    const chain: Record<string, unknown> = {}
    const filters: Array<(row: Record<string, unknown>) => boolean> = []
    let write: { kind: string; value: Record<string, unknown> } | null = null
    for (const method of ["select", "order", "limit"]) chain[method] = () => chain
    chain.eq = (key: string, value: unknown) => { filters.push(row => row[key] === value); return chain }
    chain.in = (key: string, values: unknown[]) => { filters.push(row => values.includes(row[key])); return chain }
    chain.gt = (key: string, value: string) => { filters.push(row => String(row[key]) > value); return chain }
    for (const kind of ["insert", "update"]) chain[kind] = (value: Record<string, unknown>) => { write = { kind, value }; return chain }
    const execute = (single: boolean) => {
      let rows = (mock.rows[table] || []).filter(row => filters.every(filter => filter(row)))
      if (write) {
        mock.writes.push({ table, ...write })
        if (write.kind === "insert") rows = [{ id: "inserted", ...write.value }]
        else rows = rows.map(row => ({ ...row, ...write!.value }))
      }
      return { data: single ? rows[0] || null : rows, error: null }
    }
    chain.single = chain.maybeSingle = () => Promise.resolve(execute(true))
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(execute(false)).then(resolve)
    return chain
  },
} }))

import { GET, POST, PUT } from "@/app/api/remote-links/route"
import { POST as deliver } from "@/app/api/remote-delivery/route"
import { POST as capture } from "@/app/api/remote-capture/route"
import { validateRemoteLinkScope } from "@/lib/remoteLinkScope"

const company = "11111111-1111-4111-8111-111111111111"
const otherCompany = "99999999-9999-4999-8999-999999999999"
const employee = "22222222-2222-4222-8222-222222222222"
const ppe = "33333333-3333-4333-8333-333333333333"
const workplace = "44444444-4444-4444-8444-444444444444"
const delivery = "55555555-5555-4555-8555-555555555555"
const thirdParty = "66666666-6666-4666-8666-666666666666"
const token = "a".repeat(64)
const intent = () => ({ e: employee, p: ppe, q: 2, r: "Primeira Entrega", w: workplace })
const link = (data: unknown = intent()) => ({ id: "link", token, company_id: company, employee_id: employee, type: "delivery", status: "pending", expires_at: "2099-01-01T00:00:00Z", data })
const createRequest = (data: unknown, type = "delivery") => new NextRequest("https://safeepi.example/api/remote-links", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ employee_id: employee, type, data }) })
const deliveryRequest = (overrides: Record<string, string> = {}) => {
  const form = new FormData()
  Object.entries({ employee_id: employee, ppe_id: ppe, workplace_id: workplace, quantity: "2", reason: "Primeira Entrega", token, geo_location: "-23.5505, -46.6333", ...overrides }).forEach(([key, value]) => form.set(key, value))
  form.set("signatureFile", new File(["synthetic"], "signature.png", { type: "image/png" }))
  return new Request("https://safeepi.example/api/remote-delivery", { method: "POST", body: form })
}
const alteredConfirmationCases: Array<Record<string, string>> = [
  { quantity: "3" }, { reason: "Perda" }, { workplace_id: delivery }, { third_party_id: thirdParty },
]
beforeEach(() => {
  vi.clearAllMocks()
  mock.writes.length = 0
  mock.auth.mockResolvedValue({ authorized: true, user: { id: "operator", role: "ADMIN", company_id: company } })
  mock.upload.mockResolvedValue({ error: null }); mock.remove.mockResolvedValue({ error: null })
  mock.rpc.mockResolvedValue({ data: { delivery: { id: delivery } }, error: null })
  mock.rows = {
    companies: [{ id: company, active: true, subscription_status: "ACTIVE" }],
    employees: [{ id: employee, company_id: company, active: true, full_name: "Pessoa teste", cpf: "00000000000", photo_url: "private/photo.png" }],
    ppes: [{ id: ppe, company_id: company, active: true, name: "Capacete teste", ca_number: "123", ca_expiry_date: "2099-01-01" }],
    workplaces: [{ id: workplace, company_id: company, active: true, name: "Unidade teste" }],
    third_parties: [{ id: thirdParty, company_id: company, active: true }],
    deliveries: [{ id: delivery, company_id: company, employee_id: employee, ppe_id: ppe, quantity: 2, reason: "Primeira Entrega", workplace_id: workplace }],
    remote_links: [link()],
  }
})

describe("remote link tenant and snapshot integrity", () => {
  it("rejects an employee in a different company before expiring or inserting any link", async () => {
    mock.rows.employees[0].company_id = otherCompany
    expect((await POST(createRequest(intent()))).status).toBe(403)
    expect(mock.writes).toEqual([])
  })
  it.each(["ppes", "workplaces", "third_parties"])("rejects cross-company %s", async table => {
    mock.rows[table][0].company_id = otherCompany
    expect((await POST(createRequest({ ...intent(), thirdPartyId: thirdParty }))).status).toBe(403)
    expect(mock.writes).toEqual([])
  })
  it("does not expose employee/photo data through an inconsistent historical token", async () => {
    mock.rows.employees[0].company_id = otherCompany
    const response = await GET(new NextRequest(`https://safeepi.example/api/remote-links?token=${token}`))
    expect(response.status).toBe(403)
    expect(await response.json()).not.toHaveProperty("link")
  })
  it("checks expiry before returning completed links including invalid timestamps", async () => {
    for (const expires_at of ["2000-01-01T00:00:00Z", "invalid"]) {
      mock.rows.remote_links = [{ ...link(), status: "completed", expires_at }]
      const response = await GET(new NextRequest(`https://safeepi.example/api/remote-links?token=${token}&include_completed=1`))
      expect(response.status).toBe(410)
      expect(await response.json()).not.toHaveProperty("link")
    }
  })
  it("rejects suspended company even for unexpired completed reads", async () => {
    mock.rows.companies[0].subscription_status = "SUSPENDED"
    mock.rows.remote_links[0].status = "completed"
    expect((await GET(new NextRequest(`https://safeepi.example/api/remote-links?token=${token}&include_completed=1`))).status).toBe(403)
  })
  it("preserves legacy p/q/r/w and returns canonical item names without exposing employee photos", async () => {
    const response = await GET(new NextRequest(`https://safeepi.example/api/remote-links?token=${token}`))
    expect(response.status).toBe(200)
    expect((await response.json()).link).toMatchObject({ data: { p: ppe, q: 2, items: [{ ppeId: ppe, quantity: 2, ppeName: "Capacete teste" }] }, employee: { photo_url: null } })
  })
  it.each(alteredConfirmationCases)("rejects altered confirmation fields before upload %j", async overrides => {
    expect((await deliver(deliveryRequest(overrides))).status).toBe(409)
    expect(mock.upload).not.toHaveBeenCalled(); expect(mock.rpc).not.toHaveBeenCalled()
  })
  it("uses the saved snapshot in the delivery RPC", async () => {
    expect((await deliver(deliveryRequest())).status).toBe(200)
    expect(mock.rpc).toHaveBeenCalledWith("safeepi_create_delivery", expect.objectContaining({ p_quantity: 2, p_ppe_id: ppe, p_workplace_id: workplace, p_reason: "Primeira Entrega", p_idempotency_key: "remote:link", p_auto_return_restock: false }))
  })
  it.each([
    { signatureOnly: false, rejects: false },
    { signatureOnly: false, rejects: true },
    { signatureOnly: true, rejects: false },
    { signatureOnly: true, rejects: true },
  ])("preserves the uploaded evidence after an uncertain RPC outcome %j", async ({ signatureOnly, rejects }) => {
    if (signatureOnly) mock.rows.remote_links = [link({ ...intent(), signaturePendingOnly: true, deliveryIds: [delivery] })]
    if (rejects) mock.rpc.mockRejectedValueOnce(new Error("Gateway connection closed"))
    else mock.rpc.mockResolvedValueOnce({ data: null, error: { message: "Gateway timeout" } })
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      expect((await deliver(deliveryRequest())).status).toBe(500)
      expect(mock.upload).toHaveBeenCalledTimes(1)
      expect(mock.rpc).toHaveBeenCalledWith(signatureOnly ? "safeepi_complete_delivery_signature" : "safeepi_create_delivery", expect.objectContaining({ p_signature_url: expect.any(String) }))
      // The server may have committed before the response was lost. Removing the
      // upload here would erase the evidence referenced by that delivery.
      expect(mock.remove).not.toHaveBeenCalled()
    } finally {
      log.mockRestore()
    }
  })
  it.each(["signaturePendingOnly", "signatureOnly", "signature_only"])("%s signs existing deliveries without another stock operation", async alias => {
    mock.rows.remote_links = [link({ ...intent(), [alias]: true, delivery_ids: [delivery] })]
    mock.rows.ppes[0].active = false // Archiving old deliveries does not require an active catalog item.
    mock.rpc.mockResolvedValue({ data: [{ id: delivery }], error: null })
    expect((await deliver(deliveryRequest())).status).toBe(200)
    expect(mock.rpc).toHaveBeenCalledWith("safeepi_complete_delivery_signature", expect.objectContaining({ p_delivery_ids: [delivery] }))
    expect(mock.rpc).not.toHaveBeenCalledWith("safeepi_create_delivery", expect.anything())
  })
  it("rejects signature-only IDs belonging to another employee or tenant", async () => {
    mock.rows.remote_links = [link({ ...intent(), signaturePendingOnly: true, deliveryIds: [delivery] })]
    mock.rows.deliveries[0].company_id = otherCompany
    expect((await deliver(deliveryRequest())).status).toBe(403)
    expect(mock.rpc).not.toHaveBeenCalled()
  })
  it("preserves training_signature in the historical delivery database type", async () => {
    const response = await POST(createRequest({ trainingName: "NR-06" }, "training_signature"))
    expect(response.status).toBe(200)
    expect((await response.json()).link).toMatchObject({ type: "delivery", data: { remoteType: "training_signature", trainingName: "NR-06" } })
  })
  it("rejects using a training token for an EPI operation", async () => {
    mock.rows.remote_links = [link({ ...intent(), remoteType: "training_signature" })]
    expect((await deliver(deliveryRequest())).status).toBe(403)
    expect(mock.rpc).not.toHaveBeenCalled()
  })
  it("scopes administrative completion to the operator company", async () => {
    mock.rows.remote_links[0].company_id = otherCompany
    const request = new NextRequest("https://safeepi.example/api/remote-links", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) })
    expect((await PUT(request)).status).toBe(404)
    expect(mock.writes).toEqual([])
  })
  it("rechecks company ownership before a capture can modify the employee", async () => {
    mock.rows.remote_links = [{ ...link({}), type: "capture" }]
    mock.rows.employees[0].company_id = otherCompany
    const response = await capture(new Request("https://safeepi.example/api/remote-capture", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: employee, token, photo_url: "data:image/png;base64,c3ludGhldGlj" }) }))
    expect(response.status).toBe(403); expect(mock.rpc).not.toHaveBeenCalled()
  })
  it("normalizes the legacy items representation", async () => {
    const scope = await validateRemoteLinkScope(link({ items: [{ ppeId: ppe, quantity: 2, reason: "Dano", ppeName: "Nome adulterado" }] }))
    expect(scope.items[0]).toMatchObject({ ppeId: ppe, quantity: 2, reason: "Dano", ppeName: "Capacete teste" })
  })
})
