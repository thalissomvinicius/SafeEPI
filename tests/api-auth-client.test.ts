import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ getSession: vi.fn(), refreshSession: vi.fn(), signOut: vi.fn(), fetch: vi.fn() }))
vi.mock("@/lib/supabase", () => ({ supabase: { auth: { getSession: mocks.getSession, refreshSession: mocks.refreshSession, signOut: mocks.signOut } } }))

const session = { user: { id: "verified-user", email: "operador@safeepi.test" }, access_token: "synthetic-token", expires_at: Math.floor(Date.now() / 1000) + 3600 }

describe("authentication client handoff", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.stubGlobal("fetch", mocks.fetch)
    mocks.getSession.mockResolvedValue({ data: { session }, error: null })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("authenticates once and hands the same persisted session to the provider", async () => {
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ user: session.user }), { status: 200 }))
    const sync = vi.fn()
    window.addEventListener("safeepi:auth-sync", sync)
    try {
      const { api } = await import("@/services/api")
      expect(await api.login("operador@safeepi.test", "synthetic-password")).toEqual({ session })
      expect(mocks.fetch).toHaveBeenCalledTimes(1)
      expect(mocks.fetch.mock.calls[0][0]).toBe("/api/auth/login")
      expect(mocks.getSession).toHaveBeenCalledTimes(1)
      expect(sync).toHaveBeenCalledTimes(1)
    } finally {
      window.removeEventListener("safeepi:auth-sync", sync)
    }
  })

  it.each([null, { ...session, user: { id: "stale-other-account" } }])("does not accept an absent or stale account cookie", async (storedSession) => {
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ user: session.user }), { status: 200 }))
    mocks.getSession.mockResolvedValue({ data: { session: storedSession }, error: null })
    const { api } = await import("@/services/api")
    await expect(api.login("operador@safeepi.test", "synthetic-password")).rejects.toThrow("cookies")
  })

  it("does not synchronize a rejected authentication", async () => {
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ error: "Credenciais invalidas." }), { status: 401 }))
    const { api } = await import("@/services/api")
    await expect(api.login("operador@safeepi.test", "synthetic-password")).rejects.toThrow("Credenciais invalidas")
    expect(mocks.getSession).not.toHaveBeenCalled()
  })

  it("never caches the authorization profile", async () => {
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ user: { id: "verified-user", role: "ADMIN" } }), { status: 200 }))
    const { api } = await import("@/services/api")
    await api.getCurrentUser()
    expect(mocks.fetch).toHaveBeenCalledWith("/api/me", expect.objectContaining({ cache: "no-store", signal: expect.any(AbortSignal) }))
  })

  it("ends a stalled profile request with a recoverable error", async () => {
    vi.useFakeTimers()
    mocks.fetch.mockImplementation((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true })
    }))
    const { api } = await import("@/services/api")
    const failure = expect(api.getCurrentUser()).rejects.toThrow("demorou mais que o esperado")
    await vi.advanceTimersByTimeAsync(15_000)
    await failure
    expect(mocks.signOut).not.toHaveBeenCalled()
  })
})
