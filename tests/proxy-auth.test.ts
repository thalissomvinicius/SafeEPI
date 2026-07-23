import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { proxy } from "@/proxy"

const mocks = vi.hoisted(() => ({
  getClaims: vi.fn(),
}))

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({
    auth: {
      getClaims: mocks.getClaims,
    },
  })),
}))

describe("proxy authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co")
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "publishable-key")
  })

  it("valida páginas protegidas por claims assinadas sem consultar getUser", async () => {
    mocks.getClaims.mockResolvedValue({
      data: {
        claims: {
          sub: "user-1",
          app_metadata: { role: "ADMIN" },
        },
      },
      error: null,
    })

    const response = await proxy(new NextRequest("https://safe-epi.test/delivery"))

    expect(response.status).toBe(200)
    expect(mocks.getClaims).toHaveBeenCalledTimes(1)
    expect(mocks.getClaims).toHaveBeenCalledWith()
  })

  it("usa o token Bearer verificado quando uma API não tem cookie de sessão", async () => {
    mocks.getClaims
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({
        data: { claims: { sub: "user-agent", app_metadata: { role: "ADMIN" } } },
        error: null,
      })

    const response = await proxy(new NextRequest("https://safe-epi.test/api/notifications", {
      headers: { Authorization: "Bearer agent-token" },
    }))

    expect(response.status).toBe(200)
    expect(mocks.getClaims).toHaveBeenNthCalledWith(1)
    expect(mocks.getClaims).toHaveBeenNthCalledWith(2, "agent-token")
  })

  it("continua redirecionando sessões inválidas para o login", async () => {
    mocks.getClaims.mockResolvedValue({ data: null, error: new Error("invalid token") })

    const response = await proxy(new NextRequest("https://safe-epi.test/delivery?step=2"))

    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toBe(
      "https://safe-epi.test/login?redirectTo=%2Fdelivery%3Fstep%3D2",
    )
  })
})
