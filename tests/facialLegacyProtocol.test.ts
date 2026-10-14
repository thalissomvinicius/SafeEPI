// @vitest-environment node
import { describe, expect, it, vi } from "vitest"

const upstream = vi.hoisted(() => ({ call: vi.fn(), authorize: vi.fn(), rateLimit: vi.fn() }))
vi.mock("@/lib/serverBiometric", () => ({
  callBiometricService: upstream.call,
  authorizeBiometricAccess: upstream.authorize,
  enforceBiometricRateLimit: upstream.rateLimit,
  isValidBiometricUuid: () => true,
  loadEmployeeReferenceEmbedding: vi.fn(),
}))
vi.mock("@/lib/supabaseAdmin", () => ({ supabaseAdmin: {} }))

describe("protocolo facial legado aposentado", () => {
  it.each([
    () => import("@/app/api/biometric/session/start/route"),
    () => import("@/app/api/biometric/session/frame/route"),
    () => import("@/app/api/biometric/enroll/route"),
  ])("retorna 410 sem autorizar nem chamar o motor antigo", async (load) => {
    const { POST } = await load()
    const response = await POST(new Request("http://localhost/api/biometric/legacy", { method: "POST" }))
    expect(response.status).toBe(410)
    expect(await response.json()).toMatchObject({ code: "FACIAL_PROTOCOL_RETIRED" })
    expect(upstream.call).not.toHaveBeenCalled()
    expect(upstream.authorize).not.toHaveBeenCalled()
    expect(upstream.rateLimit).not.toHaveBeenCalled()
  })
})
