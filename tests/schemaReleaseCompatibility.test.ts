// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { isMissingDatabaseColumn } from "@/lib/schemaCompatibility"

const mock = vi.hoisted(() => ({
  calls: [] as Array<{ table: string; method: string; args: unknown[] }>,
  results: {} as Record<string, Array<{ data: unknown; error: unknown }>>,
}))
vi.mock("@/lib/serverAuth", () => ({ requireAuthorizedUser: async () => ({
  authorized: true, user: { id: "operator", role: "ADMIN", company_id: "11111111-1111-4111-8111-111111111111" },
}) }))
vi.mock("@/lib/supabaseAdmin", () => ({ supabaseAdmin: {
  from: (table: string) => {
    const chain: Record<string, unknown> = {}
    const take = () => mock.results[table]?.shift() || { data: null, error: null }
    for (const method of ["select", "insert", "update", "delete", "eq", "in", "order", "limit", "filter"]) {
      chain[method] = (...args: unknown[]) => { mock.calls.push({ table, method, args }); return chain }
    }
    chain.maybeSingle = () => Promise.resolve(take())
    chain.single = () => Promise.resolve(take())
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(take()).then(resolve)
    return chain
  },
} }))
vi.mock("@/lib/privateStorage", () => ({ BIOMETRIC_BUCKET: "biometric_photos", signStorageValue: async (value: unknown) => value }))
vi.mock("@/lib/rateLimit", () => ({ rateLimit: async () => ({ success: true }), rateLimitExceededResponse: () => new Response(null, { status: 429 }) }))

import { POST, PUT } from "@/app/api/employees/update/route"
import { GET as getRemoteLinks } from "@/app/api/remote-links/route"
const employeeId = "22222222-2222-4222-8222-222222222222"
const companyId = "11111111-1111-4111-8111-111111111111"
const request = (method: string, payload: unknown) => new NextRequest("https://safe-epi.example/api/employees/update", {
  method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
})
beforeEach(() => { mock.calls.length = 0; mock.results = {} })

describe("release works with the established employee schema", () => {
  it("does not require an optional registration column to add a manual employee", async () => {
    mock.results.employees = [{ data: null, error: null }, { data: [{ id: employeeId, full_name: "TESTE" }], error: null }]
    const response = await POST(request("POST", { employee: { full_name: "TESTE", cpf: "12345678900", registration_number: null, active: true } }))
    expect(response.status).toBe(200)
    const inserted = mock.calls.find(call => call.method === "insert")?.args[0] as Array<Record<string, unknown>>
    expect(inserted[0]).not.toHaveProperty("registration_number")
    expect(inserted[0]).toMatchObject({ company_id: companyId, full_name: "TESTE" })
    expect(mock.calls.filter(call => call.method === "select").every(call => !String(call.args[0]).includes("registration_number"))).toBe(true)
  })
  it("omits a blank registration field on edits without replacing tenant checks", async () => {
    mock.results.employees = [{ data: [{ id: employeeId }], error: null }]
    const response = await PUT(request("PUT", { id: employeeId, updates: { full_name: "NOME ATUALIZADO", registration_number: "   " } }))
    expect(response.status).toBe(200)
    expect(mock.calls.find(call => call.method === "update")?.args[0]).toEqual({ full_name: "NOME ATUALIZADO" })
    expect(mock.calls).toContainEqual({ table: "employees", method: "eq", args: ["company_id", companyId] })
  })
  it("reports a precise missing nonblank registration field rather than silently dropping it", async () => {
    mock.results.employees = [{ data: null, error: { code: "PGRST204", message: "Could not find the 'registration_number' column of 'employees' in the schema cache" } }]
    const response = await PUT(request("PUT", { id: employeeId, updates: { full_name: "TESTE", registration_number: "MAT-10" } }))
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ code: "EMPLOYEE_REGISTRATION_UNAVAILABLE" })
    expect(mock.calls.filter(call => call.method === "update")).toHaveLength(1)
  })
  it("does not mistake permissions or unrelated fields for optional schema absence", () => {
    expect(isMissingDatabaseColumn({ code: "42501", message: "permission denied to registration_number" }, "registration_number")).toBe(false)
    expect(isMissingDatabaseColumn({ code: "42703", message: "column employees.department does not exist" }, "registration_number")).toBe(false)
    expect(isMissingDatabaseColumn({ code: "42703", message: "column employees.registration_number_old does not exist" }, "registration_number")).toBe(false)
    expect(isMissingDatabaseColumn({ code: "42703", message: "column employees.registration_number does not exist" }, "registration_number")).toBe(true)
  })
  it("lists pending links without selecting optional registration or biometric templates", async () => {
    mock.results.companies = [{ data: { id: companyId, active: true, subscription_status: "ACTIVE" }, error: null }]
    mock.results.remote_links = [{ data: [], error: null }]
    expect((await getRemoteLinks(new NextRequest("https://safe-epi.example/api/remote-links"))).status).toBe(200)
    const select = mock.calls.find(call => call.table === "remote_links" && call.method === "select")?.args[0]
    expect(select).toContain("employee:employees(id, full_name, cpf, company_id, active)")
    expect(select).not.toContain("registration_number")
    expect(select).not.toContain("face_descriptor")
  })
  it("opens a valid remote manual link against the classic employee schema", async () => {
    const ppeId = "33333333-3333-4333-8333-333333333333"
    mock.results.companies = [{ data: { id: companyId, active: true, subscription_status: "ACTIVE" }, error: null }]
    mock.results.employees = [{ data: { id: employeeId, company_id: companyId, active: true, full_name: "TESTE", cpf: "12345678900", photo_url: null }, error: null }]
    mock.results.ppes = [{ data: [{ id: ppeId, company_id: companyId, active: true, name: "Teste" }], error: null }]
    mock.results.remote_links = [{ data: { id: "link", company_id: companyId, employee_id: employeeId, type: "delivery", status: "pending", expires_at: "2099-01-01T00:00:00Z", data: { p: ppeId, q: 1 } }, error: null }]
    const response = await getRemoteLinks(new NextRequest(`https://safe-epi.example/api/remote-links?token=${"a".repeat(64)}`))
    expect(response.status).toBe(200)
    expect((await response.json()).link.employee.full_name).toBe("TESTE")
    expect(mock.calls.find(call => call.method === "select")?.args[0]).not.toContain("registration_number")
  })
})
