import { NextResponse } from "next/server"
import { supabaseAdmin, getSupabaseAdminConfigError } from "@/lib/supabaseAdmin"
import { PRIVATE_STORAGE_BUCKET } from "@/lib/privateStorage"
import { getClientIp } from "@/lib/getClientIp"
import { rateLimit, rateLimitExceededResponse } from "@/lib/rateLimit"
import { remoteDeliveryFieldsSchema } from "@/lib/securitySchemas"
import { isValidationResponse, validateBody } from "@/lib/validateBody"
import { validateUpload } from "@/lib/validateUpload"
import { isValidGeoLocation } from "@/utils/geolocation"
import { assertRequestSize, RequestTooLargeError } from "@/lib/requestSecurity"

const TOKEN_REGEX = /^[0-9a-f]{64}$/i
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type LinkData = Record<string, unknown> | null

function isValidToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_REGEX.test(value)
}

function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_REGEX.test(value)
}

function asLinkData(value: unknown): LinkData {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function getString(data: LinkData, key: string): string | null {
  const value = data?.[key]
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function getStringArray(data: LinkData, key: string): string[] {
  const value = data?.[key]
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : []
}

function getDeliveryIds(data: LinkData): string[] {
  return [...new Set([
    ...getStringArray(data, "deliveryIds"),
    ...getStringArray(data, "delivery_ids"),
  ].filter(isValidUuid))]
}

function isSignatureOnly(data: LinkData): boolean {
  return data?.signatureOnly === true || data?.signature_only === true
}

function normalizeReason(value: string) {
  const normalized = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
  if (normalized.includes("substituicao")) return "Substituição (Desgaste/Validade)"
  if (normalized.includes("perda")) return "Perda"
  if (normalized.includes("dano")) return "Dano"
  return "Primeira Entrega"
}

function getAutoReturnMotive(reason: string): string | null {
  if (reason === "Primeira Entrega") return null
  if (reason === "Perda") return "Baixa automatica por perda/extravio"
  if (reason === "Dano") return "Baixa automatica por dano/quebra"
  return "Baixa automatica por substituicao"
}

function shouldRestock(motive: string | null): boolean {
  if (!motive) return false
  const normalized = motive.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
  return !["perda", "extravio", "dano", "quebra"].some((term) => normalized.includes(term))
}

function normalizeDeliveryDate(value: string | null): string {
  if (!value) return new Date().toISOString()
  const parsed = value.includes("T") ? new Date(value) : new Date(`${value}T12:00:00`)
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString()
}

export async function POST(request: Request) {
  let uploadedSignaturePath: string | null = null

  const removeUploadedSignature = async () => {
    if (!uploadedSignaturePath) return
    await supabaseAdmin.storage.from(PRIVATE_STORAGE_BUCKET).remove([uploadedSignaturePath])
    uploadedSignaturePath = null
  }

  try {
    assertRequestSize(request, 20 * 1024 * 1024)
    const ipLimited = await rateLimit(`remote-delivery:ip:${getClientIp(request)}`, 20, 60 * 60 * 1000)
    if (!ipLimited.success) return rateLimitExceededResponse(ipLimited.retryAfter)

    const configError = getSupabaseAdminConfigError()
    if (configError) {
      console.error("[/api/remote-delivery]", configError)
      return NextResponse.json({ error: "Configuracao do servidor incompleta." }, { status: 500 })
    }

    const formData = await request.formData()
    const { data: fields } = validateBody(remoteDeliveryFieldsSchema, {
      employee_id: formData.get("employee_id"),
      ppe_id: formData.get("ppe_id"),
      workplace_id: formData.get("workplace_id") || undefined,
      third_party_id: formData.get("third_party_id") || undefined,
      reason: formData.get("reason") || undefined,
      quantity: formData.get("quantity") || undefined,
      ip_address: formData.get("ip_address") || undefined,
      auth_method: formData.get("auth_method") || undefined,
      token: formData.get("token"),
    })

    const employeeId = fields.employee_id
    const ppeId = fields.ppe_id
    const token = fields.token
    const reason = normalizeReason(fields.reason || "Primeira Entrega")
    const workplaceId = fields.workplace_id && fields.workplace_id !== "null" ? fields.workplace_id : null
    const geoLocation = String(formData.get("geo_location") || "").trim()
    const authMethod = fields.auth_method || "manual"
    const signatureFile = formData.get("signatureFile")

    if (!isValidUuid(employeeId) || !isValidUuid(ppeId)) {
      return NextResponse.json({ error: "Parametros invalidos." }, { status: 400 })
    }
    if (workplaceId && !isValidUuid(workplaceId)) {
      return NextResponse.json({ error: "Local de trabalho invalido." }, { status: 400 })
    }
    if (!isValidToken(token)) {
      return NextResponse.json({ error: "Token invalido." }, { status: 401 })
    }
    if (!isValidGeoLocation(geoLocation)) {
      return NextResponse.json({ error: "Localizacao obrigatoria. Permita a localizacao e tente novamente." }, { status: 400 })
    }
    if (!["manual", "facial", "manual_facial"].includes(authMethod)) {
      return NextResponse.json({ error: "Metodo de autenticacao invalido." }, { status: 400 })
    }
    if (!(signatureFile instanceof File) || signatureFile.size === 0) {
      return NextResponse.json({ error: "Arquivo de assinatura nao informado." }, { status: 400 })
    }

    const { data: link, error: linkError } = await supabaseAdmin
      .from("remote_links")
      .select("id, employee_id, company_id, type, status, expires_at, data")
      .eq("token", token)
      .maybeSingle()

    if (linkError || !link) {
      return NextResponse.json({ error: "Link nao encontrado." }, { status: 404 })
    }
    if (!link.company_id || link.employee_id !== employeeId || link.type !== "delivery") {
      return NextResponse.json({ error: "Link nao corresponde ao colaborador ou empresa." }, { status: 403 })
    }
    if (link.status !== "pending") {
      return NextResponse.json({ error: "Este link ja foi utilizado." }, { status: 410 })
    }
    if (!link.expires_at || new Date(link.expires_at) <= new Date()) {
      await supabaseAdmin.from("remote_links").update({ status: "expired" }).eq("id", link.id).eq("status", "pending")
      return NextResponse.json({ error: "Este link expirou." }, { status: 410 })
    }

    const linkLimited = await rateLimit(`remote-delivery:link:${link.id}`, 5, 60 * 60 * 1000)
    if (!linkLimited.success) return rateLimitExceededResponse(linkLimited.retryAfter)

    const validatedSignature = await validateUpload(signatureFile, "image")
    const signaturePrefix = authMethod === "facial" ? "bio" : "sig"
    uploadedSignaturePath = `${link.company_id}/signatures/${signaturePrefix}_${Date.now()}_${employeeId}.${validatedSignature.extension}`
    const { error: uploadError } = await supabaseAdmin.storage
      .from(PRIVATE_STORAGE_BUCKET)
      .upload(uploadedSignaturePath, validatedSignature.buffer, {
        contentType: validatedSignature.contentType,
        upsert: false,
      })
    if (uploadError) {
      uploadedSignaturePath = null
      return NextResponse.json({ error: "Falha ao salvar assinatura." }, { status: 500 })
    }

    const linkData = asLinkData(link.data)
    const thirdPartyIdFromForm = fields.third_party_id
    const thirdPartyId = isValidUuid(thirdPartyIdFromForm)
      ? thirdPartyIdFromForm
      : getString(linkData, "thirdPartyId")
    const safeThirdPartyId = isValidUuid(thirdPartyId) ? thirdPartyId : null
    const deliveryIds = getDeliveryIds(linkData)

    if (isSignatureOnly(linkData) && deliveryIds.length > 0) {
      const { data, error } = await supabaseAdmin.rpc("safeepi_complete_delivery_signature", {
        p_company_id: link.company_id,
        p_employee_id: employeeId,
        p_remote_link_id: link.id,
        p_delivery_ids: deliveryIds,
        p_signature_url: uploadedSignaturePath,
        p_auth_method: authMethod,
        p_ip_address: fields.ip_address || getClientIp(request),
        p_workplace_id: workplaceId,
        p_third_party_id: safeThirdPartyId,
      })
      if (error) {
        await removeUploadedSignature()
        const status = error.message.includes("consumed") ? 409 : error.message.includes("scope") ? 403 : 500
        return NextResponse.json({ error: status === 409 ? "Link ja consumido por outra requisicao." : "Falha ao salvar assinatura nas entregas." }, { status })
      }

      uploadedSignaturePath = null
      const deliveries = Array.isArray(data) ? data : []
      return NextResponse.json({
        success: true,
        data: deliveries[0] || null,
        deliveries,
        deliveryIds,
        signatureOnly: true,
        autoReturnedDeliveryIds: getStringArray(linkData, "autoReturnedDeliveryIds"),
      })
    }

    const autoReturnMotive = getAutoReturnMotive(reason)
    const { data, error } = await supabaseAdmin.rpc("safeepi_create_delivery", {
      p_company_id: link.company_id,
      p_employee_id: employeeId,
      p_ppe_id: ppeId,
      p_workplace_id: workplaceId,
      p_third_party_id: safeThirdPartyId,
      p_reason: reason,
      p_quantity: fields.quantity,
      p_signature_url: uploadedSignaturePath,
      p_auth_method: authMethod,
      p_ip_address: fields.ip_address || getClientIp(request),
      p_delivery_date: normalizeDeliveryDate(getString(linkData, "deliveryDate")),
      p_idempotency_key: `remote:${link.id}`,
      p_created_by_id: null,
      p_created_by_name: "Sistema (Entrega Remota)",
      p_remote_link_id: link.id,
      p_auto_return_motive: autoReturnMotive,
      p_auto_return_restock: shouldRestock(autoReturnMotive),
    })

    if (error) {
      await removeUploadedSignature()
      const status = error.message.includes("insufficient_stock") ? 409 :
        error.message.includes("consumed") ? 409 : error.message.includes("not_found") ? 404 : 500
      return NextResponse.json({
        error: error.message.includes("insufficient_stock")
          ? "Estoque insuficiente para concluir a entrega."
          : status === 409 ? "Link ja consumido por outra requisicao." : "Falha ao registrar entrega.",
      }, { status })
    }

    uploadedSignaturePath = null
    const result = data as { delivery?: unknown; auto_returned_delivery_ids?: string[] } | null
    return NextResponse.json({
      success: true,
      data: result?.delivery || null,
      autoReturnedDeliveryIds: result?.auto_returned_delivery_ids || [],
    })
  } catch (error) {
    await removeUploadedSignature()
    if (error instanceof RequestTooLargeError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    if (isValidationResponse(error)) return error
    console.error("[/api/remote-delivery] unexpected error:", error)
    return NextResponse.json({ error: "Erro interno do servidor." }, { status: 500 })
  }
}
