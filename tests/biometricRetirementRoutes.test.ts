// @vitest-environment node
import { describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
const m = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }))
vi.mock("@/lib/serverAuth", () => ({ requireAuthorizedUser: async () => ({ authorized: true, user: { id: "operator", role: "ADMIN", company_id: "11111111-1111-4111-8111-111111111111" } }) }))
vi.mock("@/lib/supabaseAdmin", () => ({ supabaseAdmin: { from: m.from, rpc: m.rpc } }))
import { POST as command } from "@/app/api/fingerprint/commands/route"
import { POST as pairing } from "@/app/api/fingerprint/pairings/route"
import { POST as delivery } from "@/app/api/deliveries/route"
import { POST as facial } from "@/app/api/deliveries/facial/route"

describe("APIs não permitem novas biometrias", () => {
  it.each(["enroll", "verify"])("rejeita %s antes de consultar/gravar cadastro", async operation => {
    m.from.mockClear(); m.rpc.mockClear()
    const response = await command(new Request("http://localhost/api/fingerprint/commands", { method: "POST", body: JSON.stringify({ operation, employee_id: "22222222-2222-4222-8222-222222222222" }) }))
    expect(response.status).toBe(410)
    expect(m.from).not.toHaveBeenCalled(); expect(m.rpc).not.toHaveBeenCalled()
  })
  it("rejeita pareamento sem acessar banco", async () => {
    m.from.mockClear()
    expect((await pairing(new Request("http://localhost/api/fingerprint/pairings", { method: "POST" }))).status).toBe(410)
    expect(m.from).not.toHaveBeenCalled()
  })
  it("não baixa estoque para uma nova entrega USB", async () => {
    m.rpc.mockClear()
    const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: null, error: null }) }
    m.from.mockReturnValue(chain)
    const response = await delivery(new NextRequest("http://localhost/api/deliveries", { method: "POST", body: JSON.stringify({ employee_id: "22222222-2222-4222-8222-222222222222", ppe_id: "33333333-3333-4333-8333-333333333333", reason: "Primeira Entrega", quantity: 1, auth_method: "fingerprint", idempotency_key: "retired-usb-operation" }) }))
    expect(response.status).toBe(410)
    expect(m.rpc).not.toHaveBeenCalled()
  })
  it("rejeita confirmação facial antes de consultar ou consumir evidência", async () => {
    m.from.mockClear(); m.rpc.mockClear()
    expect((await facial(new Request("http://localhost/api/deliveries/facial", { method: "POST" }))).status).toBe(503)
    expect(m.from).not.toHaveBeenCalled(); expect(m.rpc).not.toHaveBeenCalled()
  })
})
