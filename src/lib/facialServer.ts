import "server-only"
import { createHash, randomUUID } from "node:crypto"
import { NextResponse } from "next/server"
import { z } from "zod"
import { supabaseAdmin } from "@/lib/supabaseAdmin"
import { requireAuthorizedUser } from "@/lib/serverAuth"
import { callBiometricService } from "@/lib/serverBiometric"
import { rateLimit, rateLimitExceededResponse } from "@/lib/rateLimit"
import { validateUpload } from "@/lib/validateUpload"
import { readJsonWithLimit, RequestTooLargeError } from "@/lib/requestSecurity"
import { BIOMETRIC_BUCKET, PRIVATE_STORAGE_BUCKET, getSignedUrl } from "@/lib/privateStorage"
import { decryptFacialTemplate, encryptFacialTemplate, FACIAL_KEY_VERSION } from "@/lib/biometricEncryption"
import { isFacialV2Enabled } from "@/lib/facialFeature"
import {
  FACIAL_MAX_FRAME_BYTES, FACIAL_MODEL_ID, FACIAL_SESSION_TTL_SECONDS,
  facialContextInputSchema, facialEnrollmentSchema, facialReasonSchema, facialUuidSchema, facialVerificationSchema,
  type FacialDeliveryContext,
} from "@/lib/facialContract"

export class FacialError extends Error {
  constructor(message: string, readonly status = 400, readonly code = "FACIAL_INVALID_REQUEST") { super(message) }
}
export function facialErrorResponse(error: unknown): NextResponse {
  if (error instanceof NextResponse) return error
  if (error instanceof FacialError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers: { "Cache-Control": "no-store" } })
  if (error instanceof RequestTooLargeError) return NextResponse.json({ error: error.message }, { status: 413 })
  if (error instanceof z.ZodError || error instanceof SyntaxError) return NextResponse.json({ error: "Dados da solicitação facial inválidos.", code: "FACIAL_INVALID_REQUEST" }, { status: 400 })
  // Do not log captures, tokens, descriptors or raw upstream error payloads.
  console.error("[facial] operation failed", { kind: error instanceof Error ? error.name : "unknown" })
  return NextResponse.json({ error: "Verificação facial indisponível. Use a assinatura manual ou tente novamente.", code: "FACIAL_UNAVAILABLE" }, { status: 503 })
}
export function facialJson(value: unknown) { return NextResponse.json(value, { headers: { "Cache-Control": "no-store" } }) }

export function requireFacialV2Enabled() {
  if (!isFacialV2Enabled()) throw new FacialError("A verificação facial está indisponível neste ambiente. Use a assinatura manual para concluir a entrega.", 503, "FACIAL_NOT_ENABLED")
}

type FacialEmployee = { id: string; company_id: string; full_name: string; active: boolean; third_party_id: string | null }
type RemoteLink = { id: string; data: Record<string, unknown> | null; type: string; status: string; expires_at: string }
export type FacialActor = { actorId: string | null; remoteLinkId: string | null; companyId: string; employee: FacialEmployee; remoteLink: RemoteLink | null; role: string | null }

/** A valid link is a capability, never proof of a person's identity. */
export async function authorizeFacialActor(request: Request, employeeId: string, token: string | null, purpose: "enroll" | "verify" | "profile" = "verify", options: { allowCompletedRemote?: boolean } = {}): Promise<FacialActor> {
  requireFacialV2Enabled()
  if (!facialUuidSchema.safeParse(employeeId).success) throw new FacialError("Colaborador inválido.")
  let actorId: string | null = null
  let role: string | null = null
  let companyScope: string | null = null
  let remoteLink: RemoteLink | null = null
  if (token !== null) {
    if (!/^[a-f0-9]{64}$/i.test(token)) throw new FacialError("Link inválido.", 401)
    const { data: link, error } = await supabaseAdmin.from("remote_links").select("id,employee_id,company_id,type,status,expires_at,data").eq("token", token).maybeSingle()
    if (error) throw new FacialError("Não foi possível validar o link.", 503)
    if (!link || link.employee_id !== employeeId || !link.company_id) throw new FacialError("Link não pertence ao colaborador.", 403)
    const expectedType = purpose === "enroll" ? "capture" : purpose === "verify" ? "delivery" : null
    if ((expectedType && link.type !== expectedType) || !["capture", "delivery"].includes(link.type) || link.data?.remoteType) throw new FacialError("Tipo de link incompatível.", 403)
    // Only finalization replay may read a completed link; it cannot start a new verification.
    if (link.status !== "pending" && !(options.allowCompletedRemote && link.status === "completed")) throw new FacialError("Link já utilizado.", 410)
    if (!Number.isFinite(Date.parse(link.expires_at)) || Date.parse(link.expires_at) <= Date.now()) {
      if (!(options.allowCompletedRemote && link.status === "completed")) throw new FacialError("Link expirado.", 410)
    }
    companyScope = link.company_id
    remoteLink = link as RemoteLink
  } else {
    const auth = await requireAuthorizedUser(request, purpose === "enroll" ? ["MASTER", "ADMIN"] : ["MASTER", "ADMIN", "ALMOXARIFE"])
    if (!auth.authorized) throw auth.response
    actorId = auth.user.id
    role = auth.user.role
    companyScope = role === "MASTER" ? null : auth.user.company_id
  }
  let query = supabaseAdmin.from("employees").select("id,company_id,full_name,active,third_party_id").eq("id", employeeId)
  if (companyScope) query = query.eq("company_id", companyScope)
  const { data: employee, error } = await query.maybeSingle()
  if (error) throw new FacialError("Não foi possível carregar o colaborador.", 503)
  if (!employee || !employee.company_id || employee.active !== true) throw new FacialError("Colaborador não encontrado ou inativo nesta empresa.", 404)
  const { data: company, error: companyError } = await supabaseAdmin.from("companies").select("active,subscription_status").eq("id", employee.company_id).maybeSingle()
  if (companyError) throw new FacialError("Não foi possível validar a empresa.", 503)
  if (!company?.active || company.subscription_status === "SUSPENDED") throw new FacialError("Empresa desativada.", 403)
  return { actorId, role, remoteLinkId: remoteLink?.id || null, remoteLink, companyId: employee.company_id, employee: employee as FacialEmployee }
}

async function limitActor(access: FacialActor, operation: string, limit: number, windowMs = 60_000) {
  const result = await rateLimit(`facial:v2:${operation}:${access.companyId}:${access.actorId || access.remoteLinkId}`, limit, windowMs)
  if (!result.success) throw rateLimitExceededResponse(result.retryAfter)
}

/** Cap the stream even when Content-Length is absent or dishonest. */
export async function readFacialForm(request: Request) {
  const max = FACIAL_MAX_FRAME_BYTES + 32_000
  const size = Number(request.headers.get("content-length") || 0)
  if (!Number.isFinite(size) || size < 0 || size > max) throw new FacialError("Imagem muito grande. Capture novamente.", 413)
  const reader = request.body?.getReader()
  if (!reader) throw new FacialError("Captura não informada.")
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > max) { await reader.cancel(); throw new FacialError("Imagem muito grande. Capture novamente.", 413) }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  const copy = new Request(request.url, { method: "POST", headers: { "Content-Type": request.headers.get("content-type") || "" }, body: bytes })
  try { return await copy.formData() } catch { throw new FacialError("Formulário de captura inválido.") }
}
export function facialFormString(form: FormData, key: string, required = false): string | null {
  const value = form.get(key)
  if (value === null || value === "") { if (required) throw new FacialError(`Campo ${key} obrigatório.`); return null }
  if (typeof value !== "string" || value.length > (key === "context" ? 100_000 : 500)) throw new FacialError(`Campo ${key} inválido.`)
  return value
}
async function readFrame(form: FormData) {
  const frame = form.get("frame")
  if (!frame || typeof frame === "string" || frame.size > FACIAL_MAX_FRAME_BYTES) throw new FacialError("Captura inválida ou muito grande.")
  const validated = await validateUpload(frame, "image")
  if (!["image/jpeg", "image/png"].includes(validated.contentType)) throw new FacialError("Use uma captura JPEG ou PNG.")
  return { file: new File([validated.buffer], `frame.${validated.extension}`, { type: validated.contentType }), ...validated }
}
async function infer(path: string, form: FormData) {
  try { return await callBiometricService<unknown>(path, form) }
  catch (error) {
    const qualityMessages: Record<string, string> = {
      no_face: "Não encontramos um rosto. Centralize o rosto na câmera e tente novamente.",
      multiple_faces: "Há mais de um rosto na imagem. Apenas o colaborador deve aparecer.",
      low_quality: "A imagem não ficou nítida. Melhore a iluminação e capture novamente.",
      low_light: "O rosto está escuro. Vire-se para uma fonte de luz.",
      too_dark: "O rosto está escuro. Vire-se para uma fonte de luz.",
      blur: "A imagem está desfocada. Limpe a lente e segure a câmera parada.",
      low_face_size: "Ajuste a distância: o rosto deve ocupar o enquadramento indicado.",
      face_too_small: "Aproxime o rosto da câmera.",
      off_center: "Centralize o rosto no enquadramento.",
      poor_exposure: "Evite contraluz e luz muito forte no rosto.",
    }
    const reason = error instanceof Error ? error.message : ""
    if (Object.hasOwn(qualityMessages, reason)) throw new FacialError(qualityMessages[reason], 422, "FACIAL_CAPTURE_QUALITY")
    throw new FacialError("Serviço facial indisponível. Tente novamente ou use assinatura manual.", 503, "FACIAL_SERVICE_UNAVAILABLE")
  }
}

export function hashFacialContext(context: FacialDeliveryContext) {
  // Build a fixed-key snapshot so unknown JSON properties never enter the approval.
  const canonical = {
    company_id: context.company_id, employee_id: context.employee_id,
    workplace_id: context.workplace_id, third_party_id: context.third_party_id, delivery_date: context.delivery_date,
    items: context.items.map(item => ({ ppe_id: item.ppe_id, quantity: item.quantity, reason: item.reason, ca_number: item.ca_number, ppe_name: item.ppe_name })),
    ...(context.delivery_ids ? { delivery_ids: context.delivery_ids } : {}),
  }
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex")
}
function nullableId(value: unknown) { return value === "" || value === "null" || value == null ? null : facialUuidSchema.parse(value) }
function deliveryDate(value: unknown) {
  if (typeof value !== "string" || !value) return new Date().toISOString()
  const parsed = new Date(value.length === 10 ? `${value}T12:00:00-03:00` : value)
  if (!Number.isFinite(parsed.getTime())) throw new FacialError("Data da entrega inválida.")
  return parsed.toISOString()
}
async function validateContextRelation(table: "workplaces" | "third_parties", id: string | null, access: FacialActor) {
  if (!id) return
  const { data, error } = await supabaseAdmin.from(table).select("id").eq("id", id).eq("company_id", access.companyId).eq("active", true).maybeSingle()
  if (error) throw new FacialError("Não foi possível validar o vínculo da entrega.", 503)
  if (!data) throw new FacialError("Local ou terceiro não pertence à empresa ou está inativo.", 403)
}

export async function loadAuthoritativeFacialContext(access: FacialActor, raw: unknown): Promise<FacialDeliveryContext> {
  let input: unknown = raw
  let ids: string[] | undefined
  let existingRows: Array<{ id: string; ppe_id: string; quantity: number; reason: string; workplace_id: string | null; third_party_id: string | null; delivery_date: string; signature_url: string | null }> | undefined
  if (access.remoteLink) {
    const data = access.remoteLink.data || {}
    if (data.e && data.e !== access.employee.id) throw new FacialError("Colaborador do link inválido.", 403)
    const rawIds = data.deliveryIds || data.delivery_ids
    const signatureOnly = data.signatureOnly === true || data.signature_only === true || data.signaturePendingOnly === true
    if (signatureOnly) {
      ids = z.array(facialUuidSchema).min(1).max(100).parse(rawIds)
      if (new Set(ids).size !== ids.length) throw new FacialError("Entregas duplicadas no link.")
      const { data: rows, error } = await supabaseAdmin.from("deliveries").select("id,ppe_id,quantity,reason,workplace_id,third_party_id,delivery_date,signature_url").eq("company_id", access.companyId).eq("employee_id", access.employee.id).in("id", ids)
      if (error) throw new FacialError("Não foi possível carregar as entregas.", 503)
      if (!rows || rows.length !== ids.length) throw new FacialError("Entregas fora do escopo do link.", 403)
      existingRows = ids.map(id => rows.find(row => row.id === id)!)
      if (existingRows.some(row => row.signature_url)) throw new FacialError("Uma destas entregas já foi assinada.", 409)
      const first = existingRows[0]
      if (existingRows.some(row => row.workplace_id !== first.workplace_id || row.third_party_id !== first.third_party_id)) throw new FacialError("As entregas possuem locais ou terceiros diferentes. Gere links separados.")
      input = { items: existingRows.map(row => ({ ppe_id: row.ppe_id, quantity: row.quantity, reason: row.reason })), workplace_id: first.workplace_id, third_party_id: first.third_party_id, delivery_date: first.delivery_date }
    } else {
      if (Array.isArray(rawIds) && rawIds.length) throw new FacialError("Finalidade do link de entregas inválida.")
      const items = Array.isArray(data.items) && data.items.length ? data.items.map(item => {
        const entry = z.record(z.string(), z.unknown()).parse(item)
        return { ppe_id: entry.ppeId || entry.ppe_id, quantity: Number(entry.quantity), reason: entry.reason }
      }) : [{ ppe_id: data.p, quantity: Number(data.q || 1), reason: data.r || "Primeira Entrega" }]
      input = { items, workplace_id: nullableId(data.w), third_party_id: nullableId(data.thirdPartyId), delivery_date: deliveryDate(data.deliveryDate) }
    }
  }
  const parsed = facialContextInputSchema.parse(input)
  const workplaceId = parsed.workplace_id || null
  const thirdPartyId = parsed.third_party_id || null
  if (thirdPartyId !== (access.employee.third_party_id || null)) throw new FacialError("Terceiro incompatível com o cadastro do colaborador.", 403)
  await Promise.all([validateContextRelation("workplaces", workplaceId, access), validateContextRelation("third_parties", thirdPartyId, access)])
  const ppeIds = [...new Set(parsed.items.map(item => item.ppe_id))]
  if (!existingRows && ppeIds.length !== parsed.items.length) throw new FacialError("Agrupe as quantidades dos EPIs repetidos.")
  const { data: ppes, error } = await supabaseAdmin.from("ppes").select("id,name,ca_number,active").eq("company_id", access.companyId).in("id", ppeIds)
  if (error) throw new FacialError("Não foi possível carregar os EPIs.", 503)
  if (!ppes || ppes.length !== ppeIds.length || (!existingRows && ppes.some(ppe => !ppe.active))) throw new FacialError("EPI fora da empresa ou inativo.", 403)
  return {
    company_id: access.companyId, employee_id: access.employee.id, workplace_id: workplaceId, third_party_id: thirdPartyId,
    delivery_date: deliveryDate(parsed.delivery_date),
    items: parsed.items.map(item => {
      const ppe = ppes.find(ppe => ppe.id === item.ppe_id)!
      return { ...item, reason: facialReasonSchema.parse(item.reason), ca_number: ppe.ca_number || "N/A", ppe_name: ppe.name }
    }),
    ...(ids ? { delivery_ids: ids } : {}),
  }
}

type ActiveProfile = { embedding_encrypted: string; model_name: string; model_sha256: string; embedding_dimensions: number; key_version: string; updated_at: string; status: string; revoked_at: string | null }
async function readProfile(access: FacialActor) {
  const { data, error } = await supabaseAdmin.from("biometric_profiles").select("embedding_encrypted,model_name,model_sha256,embedding_dimensions,key_version,updated_at,status,revoked_at").eq("employee_id", access.employee.id).eq("company_id", access.companyId).maybeSingle()
  if (error) throw new FacialError("Cadastro facial indisponível. Verifique a migração e a configuração do servidor.", 503, "FACIAL_SCHEMA_UNAVAILABLE")
  return data as ActiveProfile | null
}
function isCompatibleProfile(profile: ActiveProfile | null): profile is ActiveProfile {
  return !!profile && profile.status === "active" && !profile.revoked_at && profile.model_name === FACIAL_MODEL_ID
    && profile.embedding_dimensions === 128 && profile.key_version === FACIAL_KEY_VERSION && !!profile.embedding_encrypted && /^[a-f0-9]{64}$/.test(profile.model_sha256 || "")
}
async function requireProfile(access: FacialActor) {
  const profile = await readProfile(access)
  if (!isCompatibleProfile(profile)) throw new FacialError("Faça um novo cadastro facial supervisionado antes de verificar a entrega.", 409, "FACIAL_RECAPTURE_REQUIRED")
  return profile
}

export async function getFacialProfile(request: Request) {
  const params = new URL(request.url).searchParams
  const access = await authorizeFacialActor(request, params.get("employee_id") || "", params.get("token"), "profile", { allowCompletedRemote: true })
  await limitActor(access, "profile", 60)
  const profile = await readProfile(access)
  // Pending enrollment has priority: an operator must see a recapture awaiting review.
  const { data: pending, error } = await supabaseAdmin.from("biometric_enrollments").select("id,model_id,photo_path").eq("employee_id", access.employee.id).eq("company_id", access.companyId).eq("status", "pending").gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false }).limit(1).maybeSingle()
  if (error) throw new FacialError("Não foi possível consultar o cadastro pendente.", 503)
  if (pending) {
    const photo = access.actorId && ["MASTER", "ADMIN"].includes(access.role || "") && pending.photo_path ? await getSignedUrl(BIOMETRIC_BUCKET, pending.photo_path) : null
    return facialJson({ status: "pending", model_id: pending.model_id, enrollment_id: access.actorId ? pending.id : undefined, photo_url: photo?.signedUrl || undefined })
  }
  return facialJson({ status: isCompatibleProfile(profile) ? "active" : profile ? "recapture_required" : "not_enrolled", model_id: profile?.model_name || null })
}

export async function enrollFacial(request: Request) {
  const form = await readFacialForm(request)
  const access = await authorizeFacialActor(request, facialFormString(form, "employee_id", true)!, facialFormString(form, "token"), "enroll")
  if (access.actorId && facialFormString(form, "supervised_confirmation") !== "true") throw new FacialError("Confirme que conferiu pessoalmente a identidade do colaborador.")
  await limitActor(access, "enroll", access.actorId ? 20 : 5, 10 * 60_000)
  const frame = await readFrame(form)
  const upstream = new FormData(); upstream.set("frame", frame.file)
  const parsed = facialEnrollmentSchema.safeParse(await infer("/v2/enroll", upstream))
  if (!parsed.success) throw new FacialError("O serviço não retornou um cadastro facial compatível.", 503)
  const embedding = encryptFacialTemplate(parsed.data.embedding, { companyId: access.companyId, employeeId: access.employee.id, modelId: parsed.data.model_id })
  const id = randomUUID()
  const path = `${access.companyId}/employees/facial/${access.employee.id}/${id}.${frame.extension}`
  // Reserve retention ownership before writing bytes. If the database outcome is
  // uncertain we do not upload; any committed pending row will expire normally.
  const { error: createError } = await supabaseAdmin.rpc("safeepi_create_facial_enrollment", {
    p_id: id, p_company_id: access.companyId, p_employee_id: access.employee.id, p_actor_id: access.actorId, p_remote_link_id: access.remoteLinkId,
    p_embedding_encrypted: embedding, p_model_id: parsed.data.model_id, p_model_sha256: parsed.data.model_sha256,
    p_quality: { score: parsed.data.quality }, p_photo_path: path, p_key_version: FACIAL_KEY_VERSION,
  })
  if (createError) {
    throw new FacialError("Não foi possível concluir o cadastro. Consulte a situação antes de repetir.", 503)
  }
  const { error: uploadError } = await supabaseAdmin.storage.from(BIOMETRIC_BUCKET).upload(path, frame.buffer, { contentType: frame.contentType, upsert: false })
  if (uploadError) throw new FacialError("Cadastro pendente: não foi possível guardar a foto para conferência. Solicite um novo cadastro ao administrador.", 503)
  if (access.actorId) await approveEnrollment(access, id)
  const photo = await getSignedUrl(BIOMETRIC_BUCKET, path)
  return facialJson({ enrollment_id: id, status: access.actorId ? "approved" : "pending", model_id: parsed.data.model_id, photo_url: photo?.signedUrl || undefined })
}
async function approveEnrollment(access: FacialActor, id: string) {
  if (!access.actorId || !["MASTER", "ADMIN"].includes(access.role || "")) throw new FacialError("Aprovação exige um administrador autorizado.", 403)
  const { error } = await supabaseAdmin.rpc("safeepi_approve_facial_enrollment", { p_enrollment_id: id, p_company_id: access.companyId, p_employee_id: access.employee.id, p_actor_id: access.actorId })
  if (error) throw new FacialError("Cadastro não aprovado. Verifique se ainda está pendente e dentro da validade.", 409)
}
export async function approveFacialEnrollment(request: Request) {
  const body = z.object({ employee_id: facialUuidSchema, enrollment_id: facialUuidSchema, confirm_identity: z.literal(true) }).parse(await readJsonWithLimit(request, 4096))
  const access = await authorizeFacialActor(request, body.employee_id, null, "enroll")
  await limitActor(access, "approve", 30)
  await approveEnrollment(access, body.enrollment_id)
  return facialJson({ enrollment_id: body.enrollment_id, status: "approved", model_id: FACIAL_MODEL_ID })
}

export async function startFacialSession(request: Request) {
  const form = await readFacialForm(request)
  const access = await authorizeFacialActor(request, facialFormString(form, "employee_id", true)!, facialFormString(form, "token"), "verify")
  const profile = await requireProfile(access)
  const context = await loadAuthoritativeFacialContext(access, access.remoteLink ? null : JSON.parse(facialFormString(form, "context", true)!))
  const id = randomUUID()
  const hash = hashFacialContext(context)
  const expiresAt = new Date(Date.now() + FACIAL_SESSION_TTL_SECONDS * 1000).toISOString()
  const { error } = await supabaseAdmin.from("biometric_sessions").insert({
    id, employee_id: access.employee.id, company_id: access.companyId, actor_id: access.actorId, remote_link_id: access.remoteLinkId,
    mode: "verify", state: "pending", decision: "pending", context_hash: hash, delivery_context: context, expires_at: expiresAt,
    reference_profile_updated_at: profile.updated_at, reference_model_id: profile.model_name, verification_nonce: randomUUID(),
  })
  if (error) throw new FacialError("Não foi possível iniciar a verificação. Tente novamente.", 503)
  return facialJson({ session_id: id, context_hash: hash, expires_at: expiresAt })
}

type FacialSession = { id: string; employee_id: string; company_id: string; actor_id: string | null; remote_link_id: string | null; state: string; decision: string; reason: string | null; expires_at: string; context_hash: string; reference_profile_updated_at: string; reference_model_id: string }
function assertSessionOwner(session: FacialSession, access: FacialActor) {
  if (session.company_id !== access.companyId || session.actor_id !== access.actorId || session.remote_link_id !== access.remoteLinkId) throw new FacialError("Sessão não pertence a este usuário ou link.", 403)
  if (!Number.isFinite(Date.parse(session.expires_at)) || Date.parse(session.expires_at) <= Date.now()) throw new FacialError("Verificação expirada. Faça uma nova captura.", 410, "FACIAL_SESSION_EXPIRED")
}
const REASON_MESSAGES: Record<string, string> = {
  approved: "Identidade e presença verificadas. Confirme o recebimento dos EPIs.",
  unavailable: "Verificação facial ainda indisponível. Use a assinatura manual.",
  rejected: "Não foi possível verificar identidade e presença. Tente novamente ou use a assinatura manual.",
}
export async function verifyFacialSession(request: Request) {
  requireFacialV2Enabled()
  const form = await readFacialForm(request)
  const id = facialUuidSchema.parse(facialFormString(form, "session_id", true))
  const { data, error } = await supabaseAdmin.from("biometric_sessions").select("id,employee_id,company_id,actor_id,remote_link_id,state,decision,reason,expires_at,context_hash,reference_profile_updated_at,reference_model_id").eq("id", id).maybeSingle()
  if (error) throw new FacialError("Não foi possível carregar a sessão.", 503)
  if (!data) throw new FacialError("Sessão não encontrada.", 404)
  const session = data as FacialSession
  const access = await authorizeFacialActor(request, session.employee_id, facialFormString(form, "token"), "verify")
  assertSessionOwner(session, access)
  await limitActor(access, `verify:${id}`, 5)
  if (session.state === "approved" && session.decision === "approved") return facialJson({ decision: "approved", reason: REASON_MESSAGES.approved, session_id: id, context_hash: session.context_hash, expires_at: session.expires_at })
  if (session.state !== "pending") throw new FacialError("Sessão já processada. Inicie uma nova captura.", 409)
  const profile = await requireProfile(access)
  if (profile.updated_at !== session.reference_profile_updated_at || profile.model_name !== session.reference_model_id) throw new FacialError("Cadastro facial alterado. Inicie uma nova verificação.", 409)
  const frame = await readFrame(form)
  const evidenceHash = createHash("sha256").update(new Uint8Array(frame.buffer)).digest("hex")
  const { data: reused, error: replayError } = await supabaseAdmin.from("biometric_sessions").select("id").eq("company_id", access.companyId).eq("evidence_hash", evidenceHash).eq("decision", "approved").limit(1).maybeSingle()
  if (replayError) throw new FacialError("Não foi possível validar a captura.", 503)
  if (reused) throw new FacialError("Esta captura já foi utilizada. Faça uma nova captura ao vivo.", 409, "FACIAL_CAPTURE_REUSED")
  const { data: locked, error: lockError } = await supabaseAdmin.from("biometric_sessions").update({ state: "processing" }).eq("id", id).eq("state", "pending").eq("decision", "pending").select("id").maybeSingle()
  if (lockError || !locked) throw new FacialError("Verificação já em processamento. Aguarde ou inicie outra captura.", 409)
  try {
    const template = decryptFacialTemplate(profile.embedding_encrypted, { companyId: access.companyId, employeeId: access.employee.id, modelId: profile.model_name })
    const upstream = new FormData()
    upstream.set("frame", frame.file); upstream.set("reference_embedding", JSON.stringify(template)); upstream.set("reference_model_id", profile.model_name)
    const result = facialVerificationSchema.safeParse(await infer("/v2/verify", upstream))
    if (!result.success || result.data.model_sha256 !== profile.model_sha256) throw new FacialError("Modelo de verificação incompatível com o cadastro. Solicite recadastro.", 503)
    const output = result.data
    let capturePath: string | null = null
    if (output.decision === "approved") {
      // Recheck after inference: a concurrent recapture/revocation invalidates this proof.
      const current = await requireProfile(access)
      if (current.updated_at !== profile.updated_at || Date.parse(session.expires_at) <= Date.now()) throw new FacialError("Cadastro alterado ou sessão expirada durante a captura. Tente novamente.", 409)
      capturePath = `${access.companyId}/signatures/facial/${id}-${randomUUID()}.${frame.extension}`
      // A persisted, unconsumed session owns the path before upload. Expiration
      // queues it even after a network failure or process termination. Approval
      // remains pending until the storage service acknowledges the exact bytes.
      const { data: reserved, error: reservationError } = await supabaseAdmin.from("biometric_sessions")
        .update({ capture_storage_path: capturePath, evidence_hash: evidenceHash })
        .eq("id", id).eq("state", "processing").is("capture_storage_path", null).select("id").maybeSingle()
      if (reservationError || !reserved) throw new FacialError("Não foi possível reservar o arquivo da captura. Tente novamente.", 503)
      const { error: uploadError } = await supabaseAdmin.storage.from(PRIVATE_STORAGE_BUCKET).upload(capturePath, frame.buffer, { contentType: frame.contentType, upsert: false })
      if (uploadError) throw new FacialError("Não foi possível arquivar a captura verificada.", 503)
    }
    const { data: saved, error: saveError } = await supabaseAdmin.from("biometric_sessions").update({
      state: output.decision, decision: output.decision, reason: output.reason, similarity_score: output.similarity ?? null,
      threshold: output.threshold ?? null, spoof_score: output.pad_score ?? null, pad_threshold: output.pad_threshold ?? null, quality_score: output.quality ?? null,
      model_id: output.model_id, model_sha256: output.model_sha256, calibration_id: output.calibration_id ?? null,
      pad_model_id: output.pad_model_id ?? null, evidence_hash: evidenceHash, capture_storage_path: capturePath, completed_at: new Date().toISOString(),
    }).eq("id", id).eq("state", "processing").select("id").maybeSingle()
    if (saveError || !saved) {
      // With a definite no-row CAS failure the upload cannot belong to a committed proof.
      if (!saveError && capturePath) await supabaseAdmin.storage.from(PRIVATE_STORAGE_BUCKET).remove([capturePath])
      throw new FacialError("Não foi possível registrar o resultado. Consulte a situação antes de repetir.", 503)
    }
    return facialJson({ decision: output.decision, reason: REASON_MESSAGES[output.decision], session_id: id, context_hash: session.context_hash, expires_at: session.expires_at })
  } catch (error) {
    await supabaseAdmin.from("biometric_sessions").update({ state: "unavailable", decision: "unavailable", reason: "verification_unavailable", completed_at: new Date().toISOString() }).eq("id", id).eq("state", "processing")
    throw error
  }
}
