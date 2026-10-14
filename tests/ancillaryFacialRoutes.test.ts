// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), from: vi.fn(),
  results: [] as Array<{ data: unknown; error: unknown }>,
  writes: [] as Array<{ method: string; payload: unknown }>,
}))
vi.mock("@/lib/serverAuth", () => ({ requireAuthorizedUser: mocks.auth }))
vi.mock("@/lib/supabaseAdmin", () => ({ supabaseAdmin: { from: mocks.from } }))
vi.mock("@/lib/rateLimit", () => ({ rateLimit: async () => ({ success: true }), rateLimitExceededResponse: vi.fn() }))

import { POST as training } from "@/app/api/trainings/route"
import { POST as remoteSignature } from "@/app/api/remote-training-signature/route"

const signature = "data:image/png;base64,c2lnbmF0dXJl"
const token = "a".repeat(64)
function request(body: unknown) {
  return new NextRequest("https://safeepi.example/api/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.results = []
  mocks.writes = []
  mocks.auth.mockResolvedValue({ authorized: true, user: { id: "operator-1", role: "ADMIN", company_id: "company-1" } })
  mocks.from.mockImplementation(() => {
    const chain: Record<string, unknown> = {}
    const take = () => mocks.results.shift() || { data: null, error: null }
    for (const method of ["select", "eq", "order"]) chain[method] = () => chain
    for (const method of ["insert", "update"]) chain[method] = (payload: unknown) => { mocks.writes.push({ method, payload }); return chain }
    chain.maybeSingle = () => Promise.resolve(take())
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(take()).then(resolve)
    return chain
  })
})

describe("Treinamentos não aceitam foto isolada como assinatura facial", () => {
  it("bloqueia facial remoto com 409 antes de consultar ou alterar o banco", async () => {
    const response = await remoteSignature(request({ token, signatureBase64: signature, authMethod: "facial" }))
    expect(response.status).toBe(409)
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.writes).toEqual([])
  })

  it("exige foto remota para manual_facial antes de consumir o link", async () => {
    const response = await remoteSignature(request({ token, signatureBase64: signature, authMethod: "manual_facial" }))
    expect(response.status).toBe(400)
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it.each(["data:image/png;base64,", "data:image/png;base64,@@@"])("não aceita foto vazia ou base64 inválido: %s", async (photoBase64) => {
    expect((await remoteSignature(request({ token, signatureBase64: signature, authMethod: "manual_facial", photoBase64 }))).status).toBe(400)
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it("bloqueia persistência de novo treinamento facial sem escrever", async () => {
    const response = await training(request({ training: { employee_id: "employee-1", auth_method: "facial" } }))
    expect(response.status).toBe(409)
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it("preserva assinatura manual remota", async () => {
    mocks.results.push({ data: { id: "link-1", type: "training_signature", status: "pending", expires_at: new Date(Date.now() + 60000).toISOString(), data: {} }, error: null }, { data: { id: "link-1" }, error: null })
    expect((await remoteSignature(request({ token, signatureBase64: signature, authMethod: "manual" }))).status).toBe(200)
    expect(mocks.writes[0]).toMatchObject({ method: "update", payload: { status: "completed", data: { authMethod: "manual", signatureBase64: signature } } })
  })

  it("preserva criação de treinamento com assinatura manual", async () => {
    mocks.results.push({ data: [{ id: "training-1" }], error: null })
    expect((await training(request({ training: { employee_id: "employee-1", auth_method: "manual" } }))).status).toBe(200)
    expect(mocks.writes[0]).toMatchObject({ method: "insert", payload: [{ employee_id: "employee-1", auth_method: "manual", company_id: "company-1" }] })
  })
})
