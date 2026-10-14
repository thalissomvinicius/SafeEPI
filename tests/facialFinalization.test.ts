// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  from: vi.fn(), rpc: vi.fn(), authorize: vi.fn(),
  legacyAuth: vi.fn(), rateLimit: vi.fn(),
}))
vi.mock("@/lib/supabaseAdmin", () => ({ supabaseAdmin: { from: mocks.from, rpc: mocks.rpc } }))
vi.mock("@/lib/serverAuth", () => ({ requireAuthorizedUser: mocks.legacyAuth }))
vi.mock("@/lib/rateLimit", () => ({ rateLimit: mocks.rateLimit, rateLimitExceededResponse: () => new Response("limited", { status: 429 }) }))
vi.mock("@/lib/facialServer", () => ({
  authorizeFacialActor: mocks.authorize,
  facialErrorResponse: (error: Error) => Response.json({ error: error.message }, { status: 403 }),
}))

const employeeId = "22222222-2222-4222-8222-222222222222"
const companyId = "33333333-3333-4333-8333-333333333333"
const actorId = "44444444-4444-4444-8444-444444444444"
const sessionId = "11111111-1111-4111-8111-111111111111"
const contextHash = "a".repeat(64)
const session = {
  id: sessionId, company_id: companyId, employee_id: employeeId, actor_id: actorId,
  remote_link_id: null, context_hash: contextHash, decision: "approved",
  capture_storage_path: `${companyId}/signatures/facial/verified.jpg`,
  expires_at: "2099-01-01T00:00:00Z", consumed_at: null,
}
function body(overrides: Record<string, unknown> = {}) {
  return new Request("http://localhost/api/deliveries/facial", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId, context_hash: contextHash, idempotency_key: "finalization-request-1", accepted: true, ...overrides }),
  })
}
function mockSession(value: Record<string, unknown> | null = session) {
  const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: value, error: null }) }
  mocks.from.mockReturnValue(query)
}
beforeEach(() => {
  vi.stubEnv("FACIAL_V2_ENABLED", "true")
  vi.clearAllMocks()
  mockSession()
  mocks.rateLimit.mockResolvedValue({ success: true })
  mocks.authorize.mockResolvedValue({ actorId, remoteLinkId: null, companyId, employee: { id: employeeId } })
  mocks.legacyAuth.mockResolvedValue({ authorized: true, user: { id: actorId, role: "ADMIN", company_id: companyId } })
  mocks.rpc.mockResolvedValue({ data: { deliveries: [{ id: "delivery", signature_url: session.capture_storage_path }], session_id: sessionId, accepted_at: "2026-10-13T12:00:00Z", receipt: { session_id: sessionId } }, error: null })
})
afterEach(() => vi.unstubAllEnvs())

describe("finalizacao facial autoritativa", () => {
  it("keeps facial confirmation disabled until its server feature is enabled", async () => {
    vi.stubEnv("FACIAL_V2_ENABLED", "false")
    const { POST } = await import("@/app/api/deliveries/facial/route")
    expect((await POST(body())).status).toBe(503)
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it("nao registra recebimento sem aceite expresso", async () => {
    const { POST } = await import("@/app/api/deliveries/facial/route")
    expect((await POST(body({ accepted: false }))).status).toBe(400)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it("rejeita troca de ator", async () => {
    const { POST } = await import("@/app/api/deliveries/facial/route")
    mocks.authorize.mockResolvedValue({ actorId: "outro", remoteLinkId: null, companyId })
    expect((await POST(body())).status).toBe(403)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it("rejeita contexto adulterado", async () => {
    const { POST } = await import("@/app/api/deliveries/facial/route")
    expect((await POST(body({ context_hash: "b".repeat(64) }))).status).toBe(409)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it("usa somente a captura verificada no servidor e transacao unica", async () => {
    const { POST } = await import("@/app/api/deliveries/facial/route")
    const result = await POST(body({ signature_url: "foto-falsa" }))
    expect(result.status).toBe(200)
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("safeepi_finalize_facial_delivery", expect.objectContaining({
      p_session_id: sessionId, p_actor_id: actorId, p_signature_url: session.capture_storage_path,
      p_accepted: true, p_context_hash: contextHash,
    }))
  })
  it("nao aprova sessao pendente ou sem captura", async () => {
    const { POST } = await import("@/app/api/deliveries/facial/route")
    mockSession({ ...session, decision: "pending", capture_storage_path: null })
    expect((await POST(body())).status).toBe(409)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it("nao remove a evidencia quando resultado da RPC e incerto", async () => {
    const { POST } = await import("@/app/api/deliveries/facial/route")
    mocks.rpc.mockRejectedValue(new Error("network disconnected"))
    const result = await POST(body())
    expect(result.status).toBe(503)
    expect(await result.json()).toMatchObject({ code: "FINALIZATION_UNCERTAIN", retry_same_request: true })
  })
  it("mantem idempotencia de uma sessao ja consumida pela mesma requisicao", async () => {
    const { POST } = await import("@/app/api/deliveries/facial/route")
    mockSession({ ...session, consumed_at: "2026-10-13T12:00:00Z", expires_at: "2026-01-01T00:00:00Z" })
    expect((await POST(body())).status).toBe(200)
    expect(mocks.rpc).toHaveBeenCalledOnce()
  })
})
