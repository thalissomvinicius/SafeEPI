// @vitest-environment node
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({
  rpc: vi.fn(), remove: vi.fn(), updates: [] as Array<{ table: string; payload: Record<string, unknown> }>,
  events: [] as string[], results: {} as Record<string, Array<{ data: unknown; error: unknown }>>,
}))
vi.mock("@/lib/supabaseAdmin", () => ({ supabaseAdmin: {
  rpc: (...args: unknown[]) => { mocks.events.push("expire"); return mocks.rpc(...args) },
  from: (table: string) => {
    mocks.events.push(table)
    const chain: Record<string, unknown> = {}
    const take = () => mocks.results[table]?.shift() || { data: null, error: null }
    for (const method of ["select", "eq", "not", "is", "lt", "order", "limit"]) chain[method] = () => chain
    chain.update = (payload: Record<string, unknown>) => { mocks.updates.push({ table, payload }); return chain }
    chain.then = (resolve: (result: unknown) => unknown) => Promise.resolve(take()).then(resolve)
    return chain
  },
  storage: { from: (bucket: string) => ({ remove: (paths: string[]) => mocks.remove(bucket, paths) }) },
} }))
import { GET } from "@/app/api/cron/biometric-retention/route"
const secret = "cron-secret-".repeat(4)
const originalSecret = process.env.CRON_SECRET
const originalKey = process.env.BIOMETRIC_ENCRYPTION_KEY
afterAll(() => {
  if (originalSecret === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = originalSecret
  if (originalKey === undefined) delete process.env.BIOMETRIC_ENCRYPTION_KEY; else process.env.BIOMETRIC_ENCRYPTION_KEY = originalKey
})
beforeEach(() => {
  vi.stubEnv("FACIAL_V2_ENABLED", "true")
  vi.clearAllMocks(); mocks.events.length = 0; mocks.updates.length = 0
  mocks.results = { employees: [{ data: [], error: null }], biometric_deletion_queue: [{ data: [], error: null }] }
  mocks.rpc.mockResolvedValue({ data: { expired_enrollments: 2, expired_sessions: 3, queued_paths: 4 }, error: null })
  mocks.remove.mockResolvedValue({ error: null })
  process.env.CRON_SECRET = secret
  process.env.BIOMETRIC_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64")
})
afterEach(() => vi.unstubAllEnvs())
const request = () => new Request("https://safe-epi.example/api/cron/biometric-retention", { headers: { Authorization: `Bearer ${secret}` } })
const rows = (...data: unknown[]) => { mocks.results.biometric_deletion_queue = [{ data, error: null }] }
const item = (path: string, bucket = "biometric_photos") => ({ id: path, storage_path: path, storage_bucket: bucket, attempts: 0 })

describe("facial retention cron", () => {
  it("preserves legacy cleanup without requiring the facial v2 RPC or bucket column", async () => {
    vi.stubEnv("FACIAL_V2_ENABLED", "false")
    mocks.results.biometric_deletion_queue = [
      { data: null, error: { code: "42703", message: "column biometric_deletion_queue.storage_bucket does not exist" } },
      { data: [{ id: "legacy", storage_path: "company/employees/legacy.jpg", attempts: 0 }], error: null },
    ]
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith("biometric_photos", ["company/employees/legacy.jpg"])
    expect(await response.json()).toMatchObject({ facialV2Enabled: false, processed: 1 })
  })
  it("does not hide a queue permission error behind a legacy schema retry", async () => {
    vi.stubEnv("FACIAL_V2_ENABLED", "false")
    mocks.results.biometric_deletion_queue = [{ data: null, error: { code: "42501", message: "permission denied to storage_bucket" } }]
    expect((await GET(request())).status).toBe(500)
    expect(mocks.remove).not.toHaveBeenCalled()
    expect(mocks.events.filter(event => event === "biometric_deletion_queue")).toHaveLength(1)
  })
  it("authenticates before querying or expiring any data", async () => {
    const response = await GET(new Request("https://safe-epi.example/api/cron/biometric-retention"))
    expect(response.status).toBe(401); expect(mocks.events).toHaveLength(0)
    process.env.CRON_SECRET = "short"
    expect((await GET(request())).status).toBe(401)
  })
  it("expires v2 records before draining and reports authoritative counters", async () => {
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(mocks.events[0]).toBe("expire")
    expect(mocks.rpc).toHaveBeenCalledWith("safeepi_expire_facial_enrollments", { p_limit: 500 })
    expect(await response.json()).toMatchObject({ expiredEnrollments: 2, expiredSessions: 3, queuedPaths: 4, processed: 0 })
  })
  it("deletes from the exact allowlisted bucket recorded by the database", async () => {
    rows(item("company/employees/pending.jpg"), item("company/signatures/facial/expired.jpg", "ppe_signatures"))
    expect((await GET(request())).status).toBe(200)
    expect(mocks.remove.mock.calls).toEqual([["biometric_photos", ["company/employees/pending.jpg"]], ["ppe_signatures", ["company/signatures/facial/expired.jpg"]]])
  })
  it("rejects traversal, encoded traversal, backslashes, unrelated URLs and unauthorized buckets", async () => {
    rows(...["../secret", "company/../secret", "company\\secret", "company/%2e%2e/secret", "company/%252e%252e/secret", "https://evil.example/secret", "company//secret", "https://project.supabase.co/storage/v1/object/sign/biometric_photos/company/../secret"].map(path => item(path)), item("company/secret.jpg", "other_bucket"))
    const response = await GET(request())
    expect(mocks.remove).not.toHaveBeenCalled()
    expect((await response.json()).failed).toBe(9)
  })
  it("normalizes legacy signed URLs for the correct bucket only", async () => {
    rows(item("https://project.supabase.co/storage/v1/object/sign/biometric_photos/company/photo.jpg?token=private"), item("https://project.supabase.co/storage/v1/object/sign/ppe_signatures/company/photo.jpg?token=private"))
    const response = await GET(request())
    expect(mocks.remove.mock.calls).toEqual([["biometric_photos", ["company/photo.jpg"]]])
    expect((await response.json()).failed).toBe(1)
  })
  it("does not let a missing legacy encryption key block required cleanup", async () => {
    delete process.env.BIOMETRIC_ENCRYPTION_KEY
    mocks.results.employees = [{ data: [{ id: "employee", company_id: "company", face_descriptor: Array(512).fill(0.2) }], error: null }]
    rows(item("company/employees/expired.jpg"))
    const response = await GET(request())
    expect(mocks.remove).toHaveBeenCalledTimes(1)
    expect(await response.json()).toMatchObject({ processed: 1, failedDescriptors: 1, legacyMigrationStatus: "configuration_missing" })
  })
  it("continues cleanup if the legacy lookup fails", async () => {
    mocks.results.employees = [{ data: null, error: { message: "old schema unavailable" } }]
    rows(item("company/employees/expired.jpg"))
    const response = await GET(request())
    expect(mocks.remove).toHaveBeenCalledTimes(1)
    expect(await response.json()).toMatchObject({ processed: 1, legacyMigrationStatus: "lookup_failed" })
  })
  it("does not drain anything when the expiry RPC itself cannot run safely", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "function missing" } })
    rows(item("company/employees/expired.jpg"))
    expect((await GET(request())).status).toBe(500)
    expect(mocks.remove).not.toHaveBeenCalled()
  })
  it("records a bounded safe storage failure and does not mark the item processed", async () => {
    rows(item("company/employees/expired.jpg")); mocks.remove.mockResolvedValue({ error: { message: "private-token" } })
    const response = await GET(request())
    expect((await response.json()).failed).toBe(1)
    expect(mocks.updates[0].payload).toMatchObject({ attempts: 1, last_error: "storage_deletion_failed" })
    expect(mocks.updates[0].payload).not.toHaveProperty("processed_at")
  })
})
// Historical retention regression coverage, independent of the active gate.
vi.mock("@/lib/facialFeature", () => ({ isFacialV2Enabled: () => process.env.FACIAL_V2_ENABLED === "true" }))
