// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/supabaseAdmin", () => ({ supabaseAdmin: {} }))
vi.mock("@/lib/serverAuth", () => ({ requireAuthorizedUser: vi.fn() }))
vi.mock("@/lib/rateLimit", () => ({ rateLimit: vi.fn(), rateLimitExceededResponse: vi.fn() }))
import { callBiometricService } from "@/lib/serverBiometric"
import { POST as retiredVerification } from "@/app/api/employees/[id]/biometric-verify/route"

const fakeFetch = vi.fn()
beforeEach(() => {
  vi.stubEnv("BIOMETRIC_SERVICE_URL", "https://private.example")
  vi.stubEnv("BIOMETRIC_SERVICE_TOKEN", "a".repeat(48))
  vi.stubEnv("NODE_ENV", "production")
  vi.stubGlobal("fetch", fakeFetch)
  fakeFetch.mockReset()
  fakeFetch.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } }))
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers() })

describe("private facial transport", () => {
  it.each(["http://private.example", "http://localhost:8001", "https://user:password@private.example", "https://private.example?secret=value", "not-a-url"])("blocks unsafe production service URL %s", async url => {
    vi.stubEnv("BIOMETRIC_SERVICE_URL", url)
    await expect(callBiometricService("/v2/enroll", new FormData())).rejects.toThrow()
    expect(fakeFetch).not.toHaveBeenCalled()
  })
  it("permits HTTP only for an explicit local development host", async () => {
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("BIOMETRIC_SERVICE_URL", "http://127.0.0.1:8001")
    await expect(callBiometricService("/v2/enroll", new FormData())).resolves.toEqual({ ok: true })
    fakeFetch.mockClear(); vi.stubEnv("BIOMETRIC_SERVICE_URL", "http://10.0.0.5:8001")
    await expect(callBiometricService("/v2/enroll", new FormData())).rejects.toThrow()
    expect(fakeFetch).not.toHaveBeenCalled()
  })
  it("refuses missing and short service secrets without claiming a local fallback", async () => {
    for (const token of ["", "short"]) {
      vi.stubEnv("BIOMETRIC_SERVICE_TOKEN", token)
      await expect(callBiometricService("/v2/enroll", new FormData())).rejects.toThrow(/indisponível|configurad/i)
    }
    expect(fakeFetch).not.toHaveBeenCalled()
  })
  it("refuses a path that can change the configured destination", async () => {
    await expect(callBiometricService("//evil.example", new FormData())).rejects.toThrow()
    await expect(callBiometricService("/../../unknown", new FormData())).rejects.toThrow()
    expect(fakeFetch).not.toHaveBeenCalled()
  })
  it("uses authenticated POST and explicitly disables redirects", async () => {
    await callBiometricService("/v2/verify", new FormData())
    const options = fakeFetch.mock.calls[0][1]
    expect(options).toMatchObject({ method: "POST", redirect: "error", cache: "no-store", headers: { Authorization: `Bearer ${"a".repeat(48)}` } })
    expect(options.signal).toBeInstanceOf(AbortSignal)
  })
  it("limits the actual response even when Content-Length is absent", async () => {
    fakeFetch.mockResolvedValue(new Response("x".repeat(65_537)))
    await expect(callBiometricService("/v2/enroll", new FormData())).rejects.toThrow(/resposta/i)
  })
  it("keeps the timeout active until the complete response body arrives", async () => {
    vi.useFakeTimers()
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('{"ok":')) } })
    fakeFetch.mockResolvedValue(new Response(stream))
    const promise = callBiometricService("/v2/enroll", new FormData())
    const assertion = expect(promise).rejects.toThrow(/tempo limite/i)
    await vi.advanceTimersByTimeAsync(10_001)
    await assertion
  })
  it("preserves only bounded machine-readable upstream errors", async () => {
    fakeFetch.mockResolvedValue(new Response(JSON.stringify({ detail: "multiple_faces" }), { status: 422 }))
    await expect(callBiometricService("/v2/enroll", new FormData())).rejects.toThrow("multiple_faces")
  })
})

describe("retired descriptor endpoint", () => {
  it("returns 410 without accepting a descriptor or running a comparison", async () => {
    const response = await retiredVerification(new Request("https://safe.example/api/employees/old/biometric-verify", { method: "POST", body: JSON.stringify({ descriptor: Array(512).fill(0.1) }) }), { params: Promise.resolve({ id: "old" }) })
    expect(response.status).toBe(410)
    expect(await response.json()).toMatchObject({ code: "FACIAL_PROTOCOL_RETIRED" })
    expect(fakeFetch).not.toHaveBeenCalled()
  })
})
