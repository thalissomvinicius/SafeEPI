import { afterEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { createPreviewSafeFetch, isBlockedPreviewAppRequest, isPreviewReadOnly, isReadOnlySupabaseRequest } from "@/lib/previewEnvironment"
import { proxy } from "@/proxy"

vi.mock("@supabase/ssr", () => ({ createServerClient: () => { throw new Error("Must reject mutation before authentication or handler execution") } }))
afterEach(() => { vi.unstubAllEnvs() })

describe("isolamento da prévia somente consulta", () => {
  it("usa o ambiente confiável no servidor mesmo sem flag pública", () => {
    vi.stubEnv("VERCEL_ENV", "preview")
    vi.stubEnv("NEXT_PUBLIC_SAFE_EPI_READ_ONLY", "false")
    expect(isPreviewReadOnly()).toBe(true)
  })

  it.each([
    ["/api/deliveries", "POST"], ["/api/companies", "DELETE"], ["/api/employees/update", "PUT"],
    ["/api/remote-delivery", "POST"], ["/api/remote-links", "POST"], ["/api/facial/enroll", "POST"],
    ["/api/signed-documents", "POST"], ["/api/cron/biometric-retention", "GET"],
    ["/api/fingerprint/agent/commands", "GET"], ["/delivery", "POST"],
  ])("bloqueia %s %s antes dos handlers e bypasses", async (path, method) => {
    vi.stubEnv("VERCEL_ENV", "preview")
    const request = new NextRequest(`https://preview.example${path}`, { method })
    const response = await proxy(request)
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: "PREVIEW_READ_ONLY" })
    expect(response.headers.get("Content-Security-Policy")).toBeTruthy()
  })

  it.each([["/api/auth/login", "POST"], ["/api/storage/signed-url", "POST"], ["/api/companies", "GET"], ["/employees", "GET"]])("mantém o caminho de consulta/autenticação %s %s", (path, method) => {
    vi.stubEnv("VERCEL_ENV", "preview")
    expect(isBlockedPreviewAppRequest(path, method)).toBe(false)
  })

  it("não altera o comportamento de gravação em produção", async () => {
    vi.stubEnv("VERCEL_ENV", "production")
    vi.stubEnv("NEXT_PUBLIC_SAFE_EPI_READ_ONLY", "false")
    const network = vi.fn().mockResolvedValue(new Response("ok"))
    const guardedFetch = createPreviewSafeFetch(network)
    expect(isBlockedPreviewAppRequest("/api/deliveries", "POST")).toBe(false)
    await guardedFetch("https://db.supabase.co/rest/v1/deliveries", { method: "POST", body: "{}" })
    expect(network).toHaveBeenCalledTimes(1)
  })

  it.each([
    ["/rest/v1/employees", "POST"], ["/rest/v1/ppes", "PATCH"], ["/rest/v1/companies", "DELETE"],
    ["/rest/v1/rpc/safeepi_create_delivery", "POST"], ["/rest/v1/rpc/safeepi_create_delivery", "GET"],
    ["/rest/v1/rpc/consume_rate_limit", "POST"], ["/storage/v1/object/ppe_signatures/test.pdf", "POST"],
    ["/storage/v1/object/upload/sign/ppe_signatures/test.pdf", "PUT"], ["/storage/v1/object/ppe_signatures", "DELETE"],
    ["/auth/v1/user", "PUT"], ["/auth/v1/admin/users", "POST"], ["/auth/v1/verify", "GET"],
    ["/auth/v1/logout", "POST"], ["/auth/v1/logout?scope=global", "POST"],
  ])("impede envio direto ou interno ao Supabase %s %s", async (path, method) => {
    vi.stubEnv("VERCEL_ENV", "preview")
    const network = vi.fn()
    const response = await createPreviewSafeFetch(network)(`https://db.supabase.co${path}`, { method })
    expect(response.status).toBe(403)
    expect(network).not.toHaveBeenCalled()
  })

  it.each([
    ["/rest/v1/employees?select=id", "GET"], ["/rest/v1/employees", "HEAD"],
    ["/rest/v1/rpc/safeepi_dashboard_delivery_buckets", "POST"], ["/rest/v1/rpc/safeepi_notification_summary", "POST"],
    ["/storage/v1/object/sign/ppe_signatures/test.pdf", "POST"], ["/storage/v1/object/list/ppe_signatures", "POST"],
    ["/storage/v1/object/ppe_signatures/test.pdf", "GET"], ["/auth/v1/token?grant_type=password", "POST"],
    ["/auth/v1/token?grant_type=refresh_token", "POST"], ["/auth/v1/logout?scope=local", "POST"], ["/auth/v1/user", "GET"],
    ["/auth/v1/.well-known/jwks.json", "GET"],
  ])("permite leitura ou manutenção normal de sessão %s %s", (path, method) => {
    expect(isReadOnlySupabaseRequest(`https://db.supabase.co${path}`, { method })).toBe(true)
  })

  it("reconhece o método do objeto Request, sem depender apenas do init", async () => {
    vi.stubEnv("VERCEL_ENV", "preview")
    const network = vi.fn()
    const request = new Request("https://db.supabase.co/rest/v1/ppes", { method: "PATCH", body: "{}" })
    expect((await createPreviewSafeFetch(network)(request)).status).toBe(403)
    expect(network).not.toHaveBeenCalled()
  })
})
