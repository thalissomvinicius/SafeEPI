// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { POST } from "@/app/api/deliveries/return/route"

const mocks = vi.hoisted(() => ({ auth: vi.fn(), from: vi.fn(), rpc: vi.fn(), read: vi.fn(), eq: vi.fn() }))
vi.mock("@/lib/serverAuth", () => ({ requireAuthorizedUser: mocks.auth }))
vi.mock("@/lib/supabaseAdmin", () => ({ supabaseAdmin: { from: mocks.from, rpc: mocks.rpc } }))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue({ authorized: true, user: { id: "operator", role: "ADMIN", company_id: "tenant-a" } })
  const query = { select: vi.fn(), eq: mocks.eq, is: vi.fn(), maybeSingle: mocks.read }
  query.select.mockReturnValue(query); mocks.eq.mockReturnValue(query); query.is.mockReturnValue(query)
  mocks.from.mockReturnValue(query)
  mocks.read.mockResolvedValue({ data: { id: "delivery-a", employee_id: "employee-a", quantity: 5, returned_quantity: 2 }, error: null })
  mocks.rpc.mockResolvedValue({ data: { ok: true, returned_quantity: 5, quantity_returned_now: 3 }, error: null })
})

function request(extra: Record<string, unknown> = {}) {
  return new NextRequest("https://safeepi.example/api/deliveries/return", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deliveryId: "delivery-a", motive: "Desgaste/Validade", ...extra }) })
}

describe("API de devolução", () => {
  it("não repõe desgaste nem demissão automaticamente e sempre consulta o tenant", async () => {
    expect((await POST(request())).status).toBe(200)
    expect(mocks.rpc).toHaveBeenLastCalledWith("safeepi_return_delivery", expect.objectContaining({ p_restock: false, p_company_id: "tenant-a" }))
    expect(mocks.eq).toHaveBeenCalledWith("company_id", "tenant-a")
    expect((await POST(request({ motive: "Demissão" }))).status).toBe(200)
    expect(mocks.rpc).toHaveBeenLastCalledWith("safeepi_return_delivery", expect.objectContaining({ p_restock: false }))
  })
  it("só admite reposição explícita em motivo elegível", async () => {
    expect((await POST(request({ restock: true }))).status).toBe(400)
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect((await POST(request({ motive: "Demissão", restock: true }))).status).toBe(200)
    expect(mocks.rpc).toHaveBeenCalledWith("safeepi_return_delivery", expect.objectContaining({ p_restock: true }))
  })
  it.each([0, -1, 1.5, "invalid"])("rejeita quantidade %s sem chamar RPC", async quantity => {
    expect((await POST(request({ quantity }))).status).toBe(400)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it("não aceita item de outro colaborador nem repetição de baseline desatualizado", async () => {
    expect((await POST(request({ employee_id: "employee-b" }))).status).toBe(404)
    const response = await POST(request({ expected_returned_quantity: 0 }))
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: "RETURN_STATE_CHANGED", returned_quantity: 2 })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it("preserva bloqueio de autenticação sem consultar dados", async () => {
    mocks.auth.mockResolvedValue({ authorized: false, response: new Response(null, { status: 403 }) })
    expect((await POST(request())).status).toBe(403)
    expect(mocks.from).not.toHaveBeenCalled()
  })
})
