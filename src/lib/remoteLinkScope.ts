import { supabaseAdmin } from "@/lib/supabaseAdmin"

type Data = Record<string, unknown>
export type RemoteScopeLink = { company_id: string; employee_id: string; type: string; data?: unknown }
export class RemoteLinkScopeError extends Error {
  constructor(message: string, readonly status = 403) { super(message) }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const record = (value: unknown): Data => value && typeof value === "object" && !Array.isArray(value) ? value as Data : {}
const optionalId = (value: unknown): string | null => {
  if (value == null || value === "" || value === "null") return null
  if (typeof value !== "string" || !UUID.test(value)) throw new RemoteLinkScopeError("Os dados deste link são inválidos.", 400)
  return value
}
function ids(value: unknown): string[] {
  if (value == null) return []
  if (!Array.isArray(value) || value.length > 1000) throw new RemoteLinkScopeError("A lista de entregas do link é inválida.", 400)
  return [...new Set(value.map(item => {
    const id = optionalId(item)
    if (!id) throw new RemoteLinkScopeError("A lista de entregas do link é inválida.", 400)
    return id
  }))]
}
export function normalizeRemoteReason(value: unknown) {
  const reason = String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
  if (reason.includes("substituicao")) return "Substituição (Desgaste/Validade)"
  if (reason.includes("perda")) return "Perda"
  if (reason.includes("dano")) return "Dano"
  return "Primeira Entrega"
}
export function isRemoteLinkExpired(expiresAt: unknown, now = Date.now()) {
  const expires = typeof expiresAt === "string" ? Date.parse(expiresAt) : NaN
  return !Number.isFinite(expires) || expires <= now
}
export function isRemoteSignatureOnly(data: unknown) {
  const snapshot = record(data)
  return snapshot.signaturePendingOnly === true || snapshot.signatureOnly === true || snapshot.signature_only === true
}

export async function requireActiveRemoteCompany(companyId: string) {
  const { data, error } = await supabaseAdmin.from("companies").select("id, active, subscription_status").eq("id", companyId).maybeSingle()
  if (error) throw new RemoteLinkScopeError("Não foi possível conferir a empresa. Tente novamente.", 503)
  if (!data?.active || data.subscription_status === "SUSPENDED") throw new RemoteLinkScopeError("A empresa deste link não está disponível.")
}

// These checks also run for existing tokens. Creation-time checks alone do not
// protect a token after an employee is moved or a company is suspended.
export async function validateRemoteLinkScope(link: RemoteScopeLink) {
  if (!optionalId(link.company_id) || !optionalId(link.employee_id)) throw new RemoteLinkScopeError("Vínculo do link inválido.")
  await requireActiveRemoteCompany(link.company_id)
  const { data: employee, error: employeeError } = await supabaseAdmin.from("employees")
    .select("id, company_id, active, full_name, cpf, photo_url, job_title, department, workplace_id, third_party_id")
    .eq("id", link.employee_id).eq("company_id", link.company_id).maybeSingle()
  if (employeeError) throw new RemoteLinkScopeError("Não foi possível conferir o colaborador. Tente novamente.", 503)
  if (!employee || employee.company_id !== link.company_id || employee.active !== true) throw new RemoteLinkScopeError("Colaborador indisponível para esta empresa.")

  const source = record(link.data)
  if (source.e && source.e !== link.employee_id) throw new RemoteLinkScopeError("O colaborador não corresponde ao link.")
  const signatureOnly = isRemoteSignatureOnly(source)
  const deliveryIds = [...new Set([...ids(source.deliveryIds), ...ids(source.delivery_ids)])]
  if (signatureOnly && !deliveryIds.length) throw new RemoteLinkScopeError("O link não contém entregas para assinar.", 400)
  const workplaceId = optionalId(source.w ?? source.workplaceId ?? source.workplace_id)
  const thirdPartyId = optionalId(source.thirdPartyId ?? source.third_party_id)
  let workplace = null
  if (workplaceId) {
    const result = await supabaseAdmin.from("workplaces").select("id, company_id, name, address, third_party_id, active")
      .eq("id", workplaceId).eq("company_id", link.company_id).maybeSingle()
    if (result.error) throw new RemoteLinkScopeError("Não foi possível conferir a unidade.", 503)
    if (!result.data || result.data.company_id !== link.company_id || (!signatureOnly && result.data.active !== true)) throw new RemoteLinkScopeError("Unidade indisponível para esta empresa.")
    workplace = result.data
  }
  if (thirdPartyId) {
    const result = await supabaseAdmin.from("third_parties").select("id, company_id, active")
      .eq("id", thirdPartyId).eq("company_id", link.company_id).maybeSingle()
    if (result.error) throw new RemoteLinkScopeError("Não foi possível conferir o terceiro.", 503)
    if (!result.data || result.data.company_id !== link.company_id || (!signatureOnly && result.data.active !== true)) throw new RemoteLinkScopeError("Terceiro indisponível para esta empresa.")
  }

  const isDelivery = link.type === "delivery" && source.remoteType !== "training_signature"
  const deliveries = deliveryIds.length ? await supabaseAdmin.from("deliveries")
    .select("id, company_id, employee_id, ppe_id, quantity, reason, workplace_id, third_party_id, delivery_date, deleted_at")
    .in("id", deliveryIds).eq("company_id", link.company_id).eq("employee_id", link.employee_id) : { data: [], error: null }
  if (deliveries.error) throw new RemoteLinkScopeError("Não foi possível conferir as entregas.", 503)
  if ((deliveries.data || []).length !== deliveryIds.length || (deliveries.data || []).some(row => row.company_id !== link.company_id || row.employee_id !== link.employee_id || row.deleted_at)) {
    throw new RemoteLinkScopeError("As entregas não correspondem ao colaborador e à empresa do link.")
  }
  const rawItems: Data[] = signatureOnly
    ? deliveryIds.map(id => { const row = deliveries.data!.find(row => row.id === id)!; return { ppeId: row.ppe_id, quantity: row.quantity, reason: row.reason } })
    : Array.isArray(source.items) && source.items.length ? source.items.map(record)
    : isDelivery ? [{ ppeId: source.p ?? source.ppe_id, quantity: source.q ?? source.quantity ?? 1, reason: source.r ?? source.reason }] : []
  if (rawItems.length > 1000 || (isDelivery && !signatureOnly && rawItems.length !== 1)) throw new RemoteLinkScopeError("Gere um link para cada nova entrega ou selecione entregas já registradas.", 400)
  const items = rawItems.map(item => {
    const ppeId = optionalId(item.ppeId ?? item.ppe_id)
    const quantity = Number(item.quantity ?? item.q ?? 1)
    if (!ppeId || !Number.isInteger(quantity) || quantity < 1 || quantity > 1000) throw new RemoteLinkScopeError("Item ou quantidade inválida no link.", 400)
    return { ppeId, quantity, reason: normalizeRemoteReason(item.reason ?? item.r) }
  })
  const ppeIds = [...new Set(items.map(item => item.ppeId))]
  const ppes = ppeIds.length ? await supabaseAdmin.from("ppes")
    .select("id, name, ca_number, ca_expiry_date, active, company_id").in("id", ppeIds).eq("company_id", link.company_id) : { data: [], error: null }
  if (ppes.error) throw new RemoteLinkScopeError("Não foi possível conferir os EPIs.", 503)
  if ((ppes.data || []).length !== ppeIds.length || (ppes.data || []).some(row => row.company_id !== link.company_id || (!signatureOnly && row.active !== true))) throw new RemoteLinkScopeError("EPI indisponível para esta empresa.")
  const enrichedItems = items.map(item => {
    const ppe = ppes.data!.find(row => row.id === item.ppeId)!
    return { ...item, ppeName: ppe.name, ppeCaNumber: ppe.ca_number, ppeCaExpiry: ppe.ca_expiry_date }
  })
  const data = isDelivery ? {
    ...source, e: link.employee_id, p: items[0]?.ppeId, q: items[0]?.quantity, r: items[0]?.reason,
    w: workplaceId, thirdPartyId, items: enrichedItems,
    ...(signatureOnly ? { signaturePendingOnly: true, deliveryIds } : {}),
  } : source
  return { data, employee, ppe: ppes.data?.find(row => row.id === items[0]?.ppeId) || null, workplace, items: enrichedItems, deliveryIds, signatureOnly, workplaceId, thirdPartyId, isDelivery }
}
