// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mock = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }))
vi.mock("@/lib/supabaseAdmin", () => ({ supabaseAdmin: { rpc: mock.rpc, from: mock.from }, getSupabaseAdminConfigError: () => null }))
vi.mock("@/lib/serverAuth", () => ({ requireAuthorizedUser: async () => ({ authorized: true, user: { id: "actor", company_id: "33333333-3333-4333-8333-333333333333", role: "ADMIN" } }) }))
vi.mock("@/lib/rateLimit", () => ({ rateLimit: async () => ({ success: true }), rateLimitExceededResponse: () => new Response(null, { status: 429 }) }))
beforeEach(() => vi.clearAllMocks())
const fields = {
  employee_id: "22222222-2222-4222-8222-222222222222",
  ppe_id: "55555555-5555-4555-8555-555555555555",
  quantity: 1, reason: "Primeira Entrega", auth_method: "facial",
}
describe("rotas legadas nao aceitam rotulo facial como prova", () => {
  it("bloqueia entrega local antes de chamar RPC", async () => {
    const { POST } = await import("@/app/api/deliveries/route")
    const result = await POST(new NextRequest("http://localhost/api/deliveries", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...fields, idempotency_key: "delivery-replay-1" }),
    }))
    expect(result.status).toBe(409)
    expect(mock.rpc).not.toHaveBeenCalled()
  })
  it("bloqueia entrega remota antes de upload ou RPC", async () => {
    const { POST } = await import("@/app/api/remote-delivery/route")
    const form = new FormData()
    Object.entries({ ...fields, token: "a".repeat(64) }).forEach(([key, value]) => form.set(key, String(value)))
    const result = await POST(new Request("http://localhost/api/remote-delivery", { method: "POST", body: form }))
    expect(result.status).toBe(409)
    expect(mock.from).not.toHaveBeenCalled()
    expect(mock.rpc).not.toHaveBeenCalled()
  })
})
