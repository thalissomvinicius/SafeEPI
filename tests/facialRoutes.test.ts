// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createHash } from "node:crypto"

const db = vi.hoisted(() => ({
  results: {} as Record<string, Array<{ data: unknown; error: unknown }>>,
  calls: [] as Array<{ table: string; method: string; args: unknown[] }>,
  auth: vi.fn(), infer: vi.fn(), rpc: vi.fn(), upload: vi.fn(), remove: vi.fn(), sign: vi.fn(),
}))
vi.mock("@/lib/supabaseAdmin", () => ({ supabaseAdmin: {
  from: (table: string) => {
    const take = () => db.results[table]?.shift() || { data: null, error: null }
    const chain: Record<string, unknown> = {}
    for (const method of ["select", "insert", "update", "eq", "gt", "order", "limit", "in", "is"]) chain[method] = (...args: unknown[]) => { db.calls.push({ table, method, args }); return chain }
    chain.maybeSingle = () => Promise.resolve(take())
    chain.then = (resolve: (result: unknown) => unknown) => Promise.resolve(take()).then(resolve)
    return chain
  },
  rpc: (name: string, payload: unknown) => { db.calls.push({ table: "rpc", method: name, args: [payload] }); return db.rpc(name, payload) },
  storage: { from: () => ({ upload: (...args: unknown[]) => { db.calls.push({ table: "storage", method: "upload", args }); return db.upload(...args) }, remove: db.remove }) },
} }))
vi.mock("@/lib/serverAuth", () => ({ requireAuthorizedUser: db.auth }))
vi.mock("@/lib/serverBiometric", () => ({ callBiometricService: db.infer }))
vi.mock("@/lib/rateLimit", () => ({ rateLimit: vi.fn(async () => ({ success: true })), rateLimitExceededResponse: vi.fn() }))
vi.mock("@/lib/privateStorage", () => ({ BIOMETRIC_BUCKET: "biometric_photos", PRIVATE_STORAGE_BUCKET: "ppe_signatures", getSignedUrl: db.sign }))

import { POST as enroll } from "@/app/api/facial/enroll/route"
import { POST as sessionRoute } from "@/app/api/facial/session/route"
import { POST as verify } from "@/app/api/facial/verify/route"
import { GET as profileRoute } from "@/app/api/facial/profile/route"
import { decryptFacialTemplate, encryptFacialTemplate } from "@/lib/biometricEncryption"
import { hashFacialContext } from "@/lib/facialServer"
import { FACIAL_MODEL_ID } from "@/lib/facialContract"

const employeeId = "11111111-1111-4111-8111-111111111111"
const companyId = "22222222-2222-4222-8222-222222222222"
const actorId = "33333333-3333-4333-8333-333333333333"
const ppeId = "44444444-4444-4444-8444-444444444444"
const sessionId = "55555555-5555-4555-8555-555555555555"
const linkId = "66666666-6666-4666-8666-666666666666"
const sha = "a".repeat(64)
const employee = { id: employeeId, company_id: companyId, full_name: "Teste", active: true, third_party_id: null }
const context = { company_id: companyId, employee_id: employeeId, workplace_id: null, third_party_id: null, delivery_date: "2026-10-13T12:00:00.000Z", items: [{ ppe_id: ppeId, quantity: 1, reason: "Primeira Entrega" as const, ca_number: "123", ppe_name: "Capacete" }] }
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0x01])
const frame = () => new File([jpeg], "capture.jpg", { type: "image/jpeg" })
const result = (data: unknown, error: unknown = null) => ({ data, error })
function enqueue(table: string, ...rows: unknown[]) { db.results[table] = rows.map(row => result(row)) }
function authRows() {
  enqueue("employees", employee)
  enqueue("companies", { active: true, subscription_status: "ACTIVE" })
}
function activeProfile() {
  return { embedding_encrypted: encryptFacialTemplate(Array(128).fill(0.1), { companyId, employeeId, modelId: FACIAL_MODEL_ID }), model_name: FACIAL_MODEL_ID, model_sha256: sha, embedding_dimensions: 128, key_version: "v2", updated_at: "2026-10-13T12:00:00Z", status: "active", revoked_at: null }
}
function session(overrides: Record<string, unknown> = {}) {
  return { id: sessionId, employee_id: employeeId, company_id: companyId, actor_id: actorId, remote_link_id: null, state: "pending", decision: "pending", reason: null, expires_at: new Date(Date.now() + 120_000).toISOString(), context_hash: hashFacialContext(context), reference_profile_updated_at: "2026-10-13T12:00:00Z", reference_model_id: FACIAL_MODEL_ID, ...overrides }
}
function request(fields: Record<string, string | File>) {
  const body = new FormData()
  for (const [key, value] of Object.entries(fields)) body.set(key, value)
  return new Request("https://safe-epi.example/api/facial", { method: "POST", body })
}
const approved = { decision: "approved", reason: "verified", model_id: FACIAL_MODEL_ID, model_sha256: sha, similarity: 0.9, threshold: 0.7, pad_score: 0.99, pad_threshold: 0.95, pad_model_id: "pad-fixture", calibration_id: "pilot-fixture", quality: 0.9 }

beforeEach(() => {
  vi.stubEnv("FACIAL_V2_ENABLED", "true")
  db.calls.length = 0; db.results = {}
  vi.clearAllMocks()
  process.env.BIOMETRIC_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64")
  db.auth.mockResolvedValue({ authorized: true, user: { id: actorId, role: "ADMIN", company_id: companyId } })
  db.rpc.mockResolvedValue(result("enrollment-id")); db.upload.mockResolvedValue({ error: null }); db.remove.mockResolvedValue({ error: null })
  db.sign.mockResolvedValue({ signedUrl: "https://private.example/temporary", path: "private" })
  authRows()
})
afterEach(() => vi.unstubAllEnvs())

describe("facial routes fail closed", () => {
  it("keeps the unconfigured release unavailable without querying v2 tables", async () => {
    vi.stubEnv("FACIAL_V2_ENABLED", "false")
    const response = await profileRoute(new Request(`https://safe-epi.example/api/facial/profile?employee_id=${employeeId}`))
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ code: "FACIAL_NOT_ENABLED" })
    expect(db.calls).toHaveLength(0)
    expect(db.infer).not.toHaveBeenCalled()
    expect(db.rpc).not.toHaveBeenCalled()
    expect((await sessionRoute(request({ employee_id: employeeId, context: JSON.stringify(context) }))).status).toBe(503)
    expect((await verify(request({ session_id: sessionId, frame: frame() }))).status).toBe(503)
    expect(db.calls).toHaveLength(0)
  })
  it("requires explicit supervised confirmation for local enrollment", async () => {
    const response = await enroll(request({ employee_id: employeeId, frame: frame() }))
    expect(response.status).toBe(400)
    expect(db.infer).not.toHaveBeenCalled()
  })
  it("does not fall through an invalid remote token to an administrator session", async () => {
    const response = await enroll(request({ employee_id: employeeId, token: "bad", frame: frame() }))
    expect(response.status).toBe(401)
    expect(db.auth).not.toHaveBeenCalled()
  })
  it("rejects cross-company employees before enrollment", async () => {
    enqueue("employees", null)
    const response = await enroll(request({ employee_id: employeeId, supervised_confirmation: "true", frame: frame() }))
    expect(response.status).toBe(404)
    expect(db.calls).toContainEqual({ table: "employees", method: "eq", args: ["company_id", companyId] })
    expect(db.infer).not.toHaveBeenCalled()
  })
  it("rejects remote delivery tokens used to enroll", async () => {
    enqueue("remote_links", { id: linkId, employee_id: employeeId, company_id: companyId, type: "delivery", status: "pending", expires_at: new Date(Date.now() + 60000).toISOString() })
    expect((await enroll(request({ employee_id: employeeId, token: "a".repeat(64), frame: frame() }))).status).toBe(403)
  })
  it("never exposes server-generated embeddings and binds encrypted templates to employee", async () => {
    db.infer.mockResolvedValue({ embedding: Array(128).fill(0.2), model_id: FACIAL_MODEL_ID, model_sha256: sha, quality: 0.9 })
    const response = await enroll(request({ employee_id: employeeId, supervised_confirmation: "true", frame: frame() }))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.status).toBe("approved")
    expect(body).not.toHaveProperty("embedding")
    const payload = db.rpc.mock.calls.find(call => call[0] === "safeepi_create_facial_enrollment")?.[1]
    expect(payload.p_embedding_encrypted.startsWith("v2.")).toBe(true)
    expect(decryptFacialTemplate(payload.p_embedding_encrypted, { companyId, employeeId, modelId: FACIAL_MODEL_ID })).toEqual(Array(128).fill(0.2))
    expect(() => decryptFacialTemplate(payload.p_embedding_encrypted, { companyId, employeeId: actorId, modelId: FACIAL_MODEL_ID })).toThrow()
    expect(db.calls.findIndex(call => call.method === "safeepi_create_facial_enrollment")).toBeLessThan(db.calls.findIndex(call => call.table === "storage" && call.method === "upload"))
  })
  it("does not upload an orphan enrollment photo without a durable pending-row acknowledgement", async () => {
    db.infer.mockResolvedValue({ embedding: Array(128).fill(0.2), model_id: FACIAL_MODEL_ID, model_sha256: sha, quality: 0.9 })
    db.rpc.mockResolvedValue({ data: null, error: { message: "Network outcome unknown" } })
    const response = await enroll(request({ employee_id: employeeId, supervised_confirmation: "true", frame: frame() }))
    expect(response.status).toBe(503)
    expect(db.upload).not.toHaveBeenCalled()
  })
  it("does not approve an enrollment when its bound image could not be uploaded", async () => {
    db.infer.mockResolvedValue({ embedding: Array(128).fill(0.2), model_id: FACIAL_MODEL_ID, model_sha256: sha, quality: 0.9 })
    db.upload.mockResolvedValue({ error: { message: "Storage unavailable" } })
    const response = await enroll(request({ employee_id: employeeId, supervised_confirmation: "true", frame: frame() }))
    expect(response.status).toBe(503)
    expect(db.rpc.mock.calls).toHaveLength(1)
    expect(db.rpc.mock.calls[0][0]).toBe("safeepi_create_facial_enrollment")
  })
  it("keeps remote enrollment pending without calling supervisor approval", async () => {
    enqueue("remote_links", { id: linkId, employee_id: employeeId, company_id: companyId, type: "capture", status: "pending", expires_at: new Date(Date.now() + 60000).toISOString() })
    db.infer.mockResolvedValue({ embedding: Array(128).fill(0.2), model_id: FACIAL_MODEL_ID, model_sha256: sha, quality: 0.9 })
    const response = await enroll(request({ employee_id: employeeId, token: "a".repeat(64), supervised_confirmation: "true", frame: frame() }))
    expect((await response.json()).status).toBe("pending")
    expect(db.rpc.mock.calls).toHaveLength(1)
  })
  it("does not store an invalid model response", async () => {
    db.infer.mockResolvedValue({ embedding: Array(512).fill(0.2), model_id: "buffalo_l", model_sha256: sha, quality: 0.9 })
    expect((await enroll(request({ employee_id: employeeId, supervised_confirmation: "true", frame: frame() }))).status).toBe(503)
    expect(db.rpc).not.toHaveBeenCalled(); expect(db.upload).not.toHaveBeenCalled()
  })
  it("limits the actual multipart body and not just its claimed length", async () => {
    const response = await enroll(new Request("https://safe-epi.example/api/facial", { method: "POST", headers: { "Content-Type": "multipart/form-data; boundary=test" }, body: "x".repeat(2_100_000) }))
    expect(response.status).toBe(413)
  })
  it("translates allowlisted capture quality errors without exposing upstream details", async () => {
    db.infer.mockRejectedValue(new Error("multiple_faces"))
    const response = await enroll(request({ employee_id: employeeId, supervised_confirmation: "true", frame: frame() }))
    expect(response.status).toBe(422)
    expect((await response.json()).error).toContain("mais de um rosto")
    authRows(); db.infer.mockRejectedValue(new Error("private-service-token-and-details"))
    const failure = await enroll(request({ employee_id: employeeId, supervised_confirmation: "true", frame: frame() }))
    expect(failure.status).toBe(503)
    expect(await failure.text()).not.toContain("private-service-token")
  })
  it("requires recapture for incompatible legacy profiles", async () => {
    enqueue("biometric_profiles", { ...activeProfile(), embedding_dimensions: 512, model_name: "buffalo_l" })
    const response = await sessionRoute(request({ employee_id: employeeId, context: JSON.stringify(context) }))
    expect(response.status).toBe(409)
    expect(db.calls.some(call => call.table === "biometric_sessions" && call.method === "insert")).toBe(false)
  })
  it("hydrates item name and CA from the current company rather than client metadata", async () => {
    enqueue("biometric_profiles", activeProfile()); enqueue("ppes", [{ id: ppeId, name: "Capacete", ca_number: "123", active: true }]); enqueue("biometric_sessions", null)
    const malicious = { ...context, company_id: actorId, items: [{ ...context.items[0], ppe_name: "fake", ca_number: "fake" }] }
    const response = await sessionRoute(request({ employee_id: employeeId, context: JSON.stringify(malicious) }))
    expect(response.status).toBe(200)
    const inserted = db.calls.find(call => call.table === "biometric_sessions" && call.method === "insert")?.args[0] as { delivery_context: typeof context }
    expect(inserted.delivery_context).toEqual(context)
  })
  it("rejects an EPI belonging to another company", async () => {
    enqueue("biometric_profiles", activeProfile()); enqueue("ppes", [])
    expect((await sessionRoute(request({ employee_id: employeeId, context: JSON.stringify(context) }))).status).toBe(403)
  })
  it("does not expose remote enrollment portraits to an operator without approval privileges", async () => {
    db.auth.mockResolvedValue({ authorized: true, user: { id: actorId, role: "ALMOXARIFE", company_id: companyId } })
    enqueue("biometric_profiles", null); enqueue("biometric_enrollments", { id: linkId, model_id: FACIAL_MODEL_ID, photo_path: "private/pending.jpg" })
    const response = await profileRoute(new Request(`https://safe-epi.example/api/facial/profile?employee_id=${employeeId}`))
    expect((await response.json()).photo_url).toBeUndefined()
    expect(db.sign).not.toHaveBeenCalled()
  })
  it("rejects a verification session from another actor", async () => {
    enqueue("biometric_sessions", session({ actor_id: linkId }))
    expect((await verify(request({ session_id: sessionId, frame: frame() }))).status).toBe(403)
    expect(db.infer).not.toHaveBeenCalled()
  })
  it("rejects expired sessions and changed enrollment versions", async () => {
    enqueue("biometric_sessions", session({ expires_at: new Date(0).toISOString() }))
    expect((await verify(request({ session_id: sessionId, frame: frame() }))).status).toBe(410)
    authRows(); enqueue("biometric_sessions", session()); enqueue("biometric_profiles", { ...activeProfile(), updated_at: "2026-10-13T15:00:00Z" })
    expect((await verify(request({ session_id: sessionId, frame: frame() }))).status).toBe(409)
    expect(db.infer).not.toHaveBeenCalled()
  })
  it("rejects reuse of a previously approved capture", async () => {
    enqueue("biometric_sessions", session(), { id: linkId }); enqueue("biometric_profiles", activeProfile())
    expect((await verify(request({ session_id: sessionId, frame: frame() }))).status).toBe(409)
    expect(db.infer).not.toHaveBeenCalled()
  })
  it("does not approve a service response missing calibrated PAD", async () => {
    enqueue("biometric_sessions", session(), null, { id: sessionId }, null); enqueue("biometric_profiles", activeProfile())
    db.infer.mockResolvedValue({ ...approved, pad_model_id: null })
    expect((await verify(request({ session_id: sessionId, frame: frame() }))).status).toBe(503)
    expect(db.upload).not.toHaveBeenCalled()
    expect(db.calls.some(call => call.table === "biometric_sessions" && call.method === "update" && (call.args[0] as { state: string }).state === "approved")).toBe(false)
  })
  it("persists only the verified frame and authoritative approval metadata", async () => {
    enqueue("biometric_sessions", session(), null, { id: sessionId }, { id: sessionId }, { id: sessionId }); const profile = activeProfile(); enqueue("biometric_profiles", profile, profile)
    db.infer.mockResolvedValue(approved)
    const response = await verify(request({ session_id: sessionId, frame: frame() }))
    expect(response.status).toBe(200)
    expect((await response.json()).decision).toBe("approved")
    expect(db.upload.mock.calls[0][0]).toMatch(new RegExp(`^${companyId}/signatures/facial/${sessionId}-`))
    const saved = db.calls.find(call => call.table === "biometric_sessions" && call.method === "update" && (call.args[0] as { state: string }).state === "approved")?.args[0] as Record<string, unknown>
    expect(saved.evidence_hash).toBe(createHash("sha256").update(jpeg).digest("hex"))
    expect(saved.capture_storage_path).toBe(db.upload.mock.calls[0][0])
    expect(saved.model_id).toBe(FACIAL_MODEL_ID)
    expect(saved.calibration_id).toBe("pilot-fixture")
    const reservationIndex = db.calls.findIndex(call => call.table === "biometric_sessions" && call.method === "update" && (call.args[0] as Record<string, unknown>).capture_storage_path && !(call.args[0] as Record<string, unknown>).decision)
    expect(reservationIndex).toBeGreaterThan(-1)
    expect(reservationIndex).toBeLessThan(db.calls.findIndex(call => call.table === "storage" && call.method === "upload"))
  })
  it("does not upload verification evidence without a durable path reservation", async () => {
    enqueue("biometric_sessions", session(), null, { id: sessionId }, null, null); const profile = activeProfile(); enqueue("biometric_profiles", profile, profile)
    db.infer.mockResolvedValue(approved)
    const response = await verify(request({ session_id: sessionId, frame: frame() }))
    expect(response.status).toBe(503)
    expect(db.upload).not.toHaveBeenCalled()
  })
  it("returns an already recorded approval without repeating inference or upload", async () => {
    enqueue("biometric_sessions", session({ state: "approved", decision: "approved" }))
    expect((await verify(request({ session_id: sessionId, frame: frame() }))).status).toBe(200)
    expect(db.infer).not.toHaveBeenCalled(); expect(db.upload).not.toHaveBeenCalled()
  })
})
