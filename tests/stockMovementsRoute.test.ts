// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({ auth: vi.fn(), from: vi.fn(), rpc: vi.fn(), range: vi.fn(), eq: vi.fn() }))
vi.mock("@/lib/serverAuth", () => ({ requireAuthorizedUser: mocks.auth }))
vi.mock("@/lib/supabaseAdmin", () => ({ supabaseAdmin: { from: mocks.from, rpc: mocks.rpc } }))
import { GET, POST } from "@/app/api/stock-movements/route"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue({ authorized: true, user: { id: "operator", email: "operator@example.org", role: "ADMIN", company_id: "company-1" } })
  mocks.rpc.mockResolvedValue({ data: { current_stock: 0 }, error: null })
  const query: Record<string, unknown> = {}
  query.select = query.order = () => query
  query.eq = mocks.eq.mockImplementation(() => query)
  query.range = mocks.range.mockImplementation(() => query)
  query.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [{ id: "movement-1", ppe: { name: "EPI antigo", active: false } }], count: 501, error: null }).then(resolve)
  mocks.from.mockReturnValue(query)
})

describe("histórico de estoque", () => {
  it("preserva item inativo, restringe empresa e informa páginas restantes", async () => {
    const response = await GET(new NextRequest("https://safeepi.example/api/stock-movements?limit=100&offset=100"))
    expect(await response.json()).toMatchObject({ movements: [{ ppe: { active: false } }], hasMore: true, total: 501, offset: 100, limit: 100 })
    expect(mocks.range).toHaveBeenCalledWith(100, 199)
    expect(mocks.eq).toHaveBeenCalledWith("company_id", "company-1")
  })
  it.each(["limit=501", "offset=-1", "limit=1.5", "offset=bad"])("rejeita paginação inválida (%s)", async (params) => {
    expect((await GET(new NextRequest(`https://safeepi.example/api/stock-movements?${params}`))).status).toBe(400)
    expect(mocks.from).not.toHaveBeenCalled()
  })
  it.each([["AJUSTE", 0, 200], ["ENTRADA", 0, 400], ["SAIDA", 0, 400], ["ENTRADA", 1.5, 400]])("valida %s de %s sem arredondar silenciosamente", async (type, quantity, status) => {
    const request = new NextRequest("https://safeepi.example/api/stock-movements", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ppe_id: "ppe-1", quantity, type }) })
    expect((await POST(request)).status).toBe(status)
    if (status === 400) expect(mocks.rpc).not.toHaveBeenCalled()
  })
})
