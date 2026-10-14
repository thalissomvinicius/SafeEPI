// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const state = vi.hoisted(() => ({
  metadataRole: "ADMIN" as unknown,
  profileRole: "ADMIN" as unknown,
  membershipRole: "ADMIN" as unknown,
  membershipActive: true,
  profileError: null as unknown,
  membershipError: null as unknown,
  companyError: null as unknown,
  companyActive: true,
  writes: [] as Array<{ table: string; payload: unknown }>,
  queries: [] as Array<{ table: string; method: string; args: unknown[] }>,
}))
const companyId = "11111111-1111-4111-8111-111111111111"
const ppeId = "22222222-2222-4222-8222-222222222222"

vi.mock("@/lib/privateStorage", () => ({ signStorageValue: async (value: unknown) => value }))
vi.mock("@/lib/supabaseAdmin", () => ({
  getSupabaseAdminConfigError: () => null,
  supabaseAdmin: {
    auth: { getUser: async () => ({ data: { user: {
      id: "user-1", email: "fixture@example.test", app_metadata: { role: state.metadataRole },
      user_metadata: { role: "MASTER" },
    } }, error: null }) },
    from: (table: string) => {
      const company = { id: companyId, active: state.companyActive, subscription_status: "ACTIVE" }
      const result = () => {
        if (table === "profiles") return { data: { id: "user-1", role: state.profileRole, company_id: state.profileRole === "MASTER" ? null : companyId }, error: state.profileError }
        if (table === "company_users") return { data: state.membershipActive ? { company_id: companyId, role: state.membershipRole, company } : null, error: state.membershipError }
        if (table === "companies") return { data: company, error: state.companyError }
        return { data: { id: ppeId, name: "Óculos atualizado" }, error: null }
      }
      const chain: Record<string, unknown> = {}
      for (const method of ["select", "eq", "order", "limit", "range"]) chain[method] = (...args: unknown[]) => {
        state.queries.push({ table, method, args }); return chain
      }
      for (const method of ["update", "insert", "upsert"]) chain[method] = (payload: unknown) => {
        state.writes.push({ table, payload }); return chain
      }
      chain.maybeSingle = async () => result()
      chain.single = async () => result()
      chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve)
      return chain
    },
  },
}))

import { requireAuthorizedUser } from "@/lib/serverAuth"
import { GET as getMe } from "@/app/api/me/route"
import { PUT as updatePpe } from "@/app/api/ppes/route"
import { POST as createThirdParty, PUT as updateThirdParty, DELETE as deleteThirdParty } from "@/app/api/third-parties/route"
import { POST as createTraining } from "@/app/api/trainings/route"
import { visibleNavigation } from "@/components/layout/navigation"

const request = (method = "GET", body?: unknown) => new NextRequest("https://safeepi.example/api/test", {
  method, headers: { authorization: "Bearer valid-session", "Content-Type": "application/json" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
})
beforeEach(() => {
  Object.assign(state, { metadataRole: "ADMIN", profileRole: "ADMIN", membershipRole: "ADMIN", membershipActive: true,
    profileError: null, membershipError: null, companyError: null, companyActive: true })
  state.writes.length = 0
  state.queries.length = 0
})

describe("authoritative active membership", () => {
  it("revokes ordinary API access despite an old ADMIN profile and metadata", async () => {
    state.membershipActive = false
    const result = await requireAuthorizedUser(request())
    expect(result.authorized).toBe(false)
    if (!result.authorized) expect(result.response.status).toBe(403)
    expect((await getMe(request())).status).toBe(403)
    expect(state.writes).toEqual([])
  })
  it("uses the current membership role over stale ADMIN metadata", async () => {
    state.membershipRole = "DIRETORIA"
    const result = await requireAuthorizedUser(request(), ["ADMIN"])
    expect(result.authorized).toBe(false)
    const me = await getMe(request())
    expect(me.status).toBe(200)
    expect((await me.json()).user.role).toBe("DIRETORIA")
  })
  it.each(["profileError", "membershipError", "companyError"] as const)("fails closed on %s", async key => {
    state[key] = { code: "08006", message: "connection failed" }
    const result = await requireAuthorizedUser(request())
    expect(result.authorized).toBe(false)
    if (!result.authorized) expect(result.response.status).toBeGreaterThanOrEqual(500)
    expect(state.writes).toEqual([])
  })
  it("preserves the trusted profile-only legacy platform owner", async () => {
    state.metadataRole = undefined
    state.profileRole = "MASTER"
    state.membershipActive = false
    expect(await requireAuthorizedUser(request(), ["MASTER"])).toMatchObject({ authorized: true, user: { role: "MASTER", company_id: null } })
    expect((await (await getMe(request())).json()).user).toMatchObject({ role: "MASTER", company_id: null })
  })
  it("preserves an app-metadata MASTER without a company membership", async () => {
    state.metadataRole = "MASTER"
    state.membershipActive = false
    expect(await requireAuthorizedUser(request(), ["MASTER"])).toMatchObject({ authorized: true, user: { role: "MASTER" } })
  })
  it("does not promote an ordinary user from client metadata or membership MASTER", async () => {
    state.metadataRole = undefined
    state.profileRole = "ADMIN"
    state.membershipRole = "MASTER"
    expect((await requireAuthorizedUser(request())).authorized).toBe(false)
  })
  it("denies suspended company access", async () => {
    state.companyActive = false
    expect((await requireAuthorizedUser(request())).authorized).toBe(false)
    expect((await getMe(request())).status).toBe(403)
  })
  it("returns a recoverable profile response when membership lookup fails", async () => {
    state.membershipError = { code: "08006" }
    expect((await getMe(request())).status).toBe(503)
    expect(state.writes).toEqual([])
  })
})

describe("operational role and stock boundaries", () => {
  it("does not let a read-only director edit catalog or create training", async () => {
    state.membershipRole = "DIRETORIA"
    expect((await updatePpe(request("PUT", { id: ppeId, updates: { name: "Alterado" } }))).status).toBe(403)
    expect((await createTraining(request("POST", { training: {} }))).status).toBe(403)
    expect(state.writes).toEqual([])
  })
  it.each([createThirdParty, updateThirdParty, deleteThirdParty])("rejects third-party writes by DIRETORIA", async route => {
    state.membershipRole = "DIRETORIA"
    expect((await route(request("POST", {}))).status).toBe(403)
    expect(state.writes).toEqual([])
  })
  it("refuses direct balance replacement instead of silently discarding it", async () => {
    expect((await updatePpe(request("PUT", { id: ppeId, updates: { current_stock: 999, name: "Óculos" } }))).status).toBe(400)
    expect(state.writes).toEqual([])
  })
  it.each([{ cost: -1 }, { lifespan_days: 1.5 }, { name: "   " }, { ca_expiry_date: "2026-02-31" }, { cost: "12" }])("rejects invalid catalog updates: %j", async updates => {
    expect((await updatePpe(request("PUT", { id: ppeId, updates }))).status).toBe(400)
    expect(state.writes).toEqual([])
  })
  it("keeps ordinary valid catalog editing and scopes the write to the tenant", async () => {
    state.membershipRole = "ALMOXARIFE"
    const updates = { name: "  Óculos atualizado  ", ca_number: "12345", cost: 20, ca_expiry_date: "2027-01-01" }
    expect((await updatePpe(request("PUT", { id: ppeId, updates }))).status).toBe(200)
    expect(state.writes).toEqual([{ table: "ppes", payload: { ...updates, name: "Óculos atualizado" } }])
    expect(state.queries).toContainEqual({ table: "ppes", method: "eq", args: ["company_id", companyId] })
  })
  it("does not let catalog PUT bypass MASTER-only EPI deactivation", async () => {
    expect((await updatePpe(request("PUT", { id: ppeId, updates: { active: false } }))).status).toBe(403)
    expect(state.writes).toEqual([])
  })
  it("exposes delivery navigation to the authorized warehouse operator", () => {
    expect(visibleNavigation("ALMOXARIFE").some(item => item.href === "/delivery")).toBe(true)
    expect(visibleNavigation("DIRETORIA").some(item => item.href === "/delivery")).toBe(false)
    expect(visibleNavigation(undefined)).toEqual([])
  })
})
