import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { PRIVATE_STORAGE_BUCKET } from "@/lib/privateStorage"
import { getClientIp } from "@/lib/getClientIp"
import { rateLimit, rateLimitExceededResponse } from "@/lib/rateLimit"
import { remoteDeliveryFieldsSchema } from "@/lib/securitySchemas"
import { isValidationResponse, validateBody } from "@/lib/validateBody"
import { validateUpload } from "@/lib/validateUpload"
import { isValidGeoLocation } from "@/utils/geolocation"

type SupabaseLikeError = {
  code?: string
  details?: string | null
  hint?: string | null
  message?: string
}

type DeliveryInsertRow = {
  id?: string
  [key: string]: unknown
}

type SupabaseMutationResult = { error: SupabaseLikeError | null }
type SupabaseSelectResult = { data: { current_stock?: unknown } | null; error: SupabaseLikeError | null }
type SupabaseInsertBuilder = { select: () => PromiseLike<SupabaseMutationResult> }
type SupabaseUpdateBuilder = PromiseLike<SupabaseMutationResult> & {
  eq: (column: string, value: unknown) => SupabaseUpdateBuilder
}
type SupabaseSelectBuilder = {
  eq: (column: string, value: unknown) => SupabaseSelectBuilder
  maybeSingle: () => PromiseLike<SupabaseSelectResult>
}
type SupabaseAdminClient = {
  from: (table: string) => {
    insert: (rows: Record<string, unknown>[]) => SupabaseInsertBuilder
    select: (columns: string) => SupabaseSelectBuilder
    update: (payload: Record<string, unknown>) => SupabaseUpdateBuilder
  }
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TOKEN_REGEX = /^[0-9a-f]{64}$/i

function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_REGEX.test(value)
}

function isValidToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_REGEX.test(value)
}

function normalizeDeliveryReason(reason: string) {
  const normalized = reason
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()

  if (normalized.includes("primeira") || normalized.includes("prim")) return "Primeira Entrega"
  if (normalized.includes("substitu")) return "Substituição (Desgaste/Validade)"
  if (normalized.includes("perda")) return "Perda"
  if (normalized.includes("dano")) return "Dano"
  return "Primeira Entrega"
}

function uniqueDeliveryReasons(reasons: string[]) {
  return Array.from(new Set(reasons.filter(Boolean)))
}

function getDeliveryReasonStorageVariants(reason: string) {
  const normalizedReason = normalizeDeliveryReason(reason)
  const normalizedText = normalizedReason
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()

  if (normalizedText.includes("substitu")) {
    return uniqueDeliveryReasons([
      "Substituição (Desgaste/Validade)",
      "Substitui\u00c3\u00a7\u00c3\u00a3o (Desgaste/Validade)",
      "Substituicao (Desgaste/Validade)",
      normalizedReason,
    ])
  }

  return [normalizedReason]
}

function isDeliverySchemaCompatibilityIssue(error: unknown) {
  if (!error || typeof error !== "object") return false
  const maybeError = error as SupabaseLikeError
  const text = `${maybeError.message || ""} ${maybeError.details || ""} ${maybeError.hint || ""}`.toLowerCase()

  return (
    maybeError.code === "PGRST204" ||
    maybeError.code === "42703" ||
    text.includes("schema cache") ||
    text.includes("could not find the") ||
    (text.includes("column") && (text.includes("auth_method") || text.includes("workplace_id") || text.includes("third_party_id")))
  )
}

function isMissingReturnMotiveIssue(error: unknown) {
  if (!error || typeof error !== "object") return false
  const maybeError = error as SupabaseLikeError
  const text = `${maybeError.message || ""} ${maybeError.details || ""} ${maybeError.hint || ""}`.toLowerCase()

  return (
    (maybeError.code === "PGRST204" || maybeError.code === "42703") &&
    text.includes("return_motive")
  )
}

function isMissingDeliveryIdColumnIssue(error: unknown) {
  if (!error || typeof error !== "object") return false
  const maybeError = error as SupabaseLikeError
  const text = `${maybeError.message || ""} ${maybeError.details || ""} ${maybeError.hint || ""}`.toLowerCase()
  return (
    maybeError.code === "PGRST204" ||
    maybeError.code === "42703" ||
    text.includes("schema cache") ||
    text.includes("could not find") ||
    text.includes("column")
  ) && text.includes("delivery_id")
}

function isDeliveryReasonConstraintIssue(error: unknown) {
  if (!error || typeof error !== "object") return false
  const maybeError = error as SupabaseLikeError
  const text = `${maybeError.message || ""} ${maybeError.details || ""}`.toLowerCase()
  return maybeError.code === "23514" && (text.includes("reason") || text.includes("deliveries"))
}

function shouldAutoReturnReason(reason: string) {
  return reason !== "Primeira Entrega"
}

function shouldRestockReturnedDelivery(motive: string): boolean {
  const normalized = motive
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()

  return !(
    normalized.includes("perda") ||
    normalized.includes("extravio") ||
    normalized.includes("dano") ||
    normalized.includes("quebra")
  )
}

function getAutoReturnMotive(reason: string) {
  const normalized = reason
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()

  if (normalized.includes("perda")) return "Baixa automatica por perda/extravio"
  if (normalized.includes("dano")) return "Baixa automatica por dano/quebra"
  return "Baixa automatica por substituicao"
}

function parseStock(raw: unknown): number | null {
  if (typeof raw === "number") return raw
  if (typeof raw === "string") {
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

async function insertRemoteReturnMovement(
  supabaseAdmin: SupabaseAdminClient,
  payload: Record<string, unknown>,
) {
  const firstTry = await supabaseAdmin
    .from("stock_movements")
    .insert([payload])
    .select()

  if (!firstTry.error) return firstTry
  if (!isMissingDeliveryIdColumnIssue(firstTry.error)) return firstTry

  const fallback = { ...payload }
  delete fallback.delivery_id
  return supabaseAdmin.from("stock_movements").insert([fallback]).select()
}

async function restockRemoteReturnedPpe(
  supabaseAdmin: SupabaseAdminClient,
  ppeId: string,
  companyId: string | null,
  quantity: number,
  motive: string,
  deliveryId: string,
) {
  if (quantity <= 0) return

  const { data: stockBeforeData, error: stockBeforeError } = await supabaseAdmin
    .from("ppes")
    .select("current_stock")
    .eq("id", ppeId)
    .maybeSingle()

  if (stockBeforeError) throw stockBeforeError
  const stockBefore = parseStock((stockBeforeData as { current_stock?: unknown } | null)?.current_stock)

  const movementPayload: Record<string, unknown> = {
    ppe_id: ppeId,
    quantity,
    type: "ENTRADA",
    motive: `Devolucao de EPI (${motive})`,
    delivery_id: deliveryId,
    created_by_name: "Sistema (Entrega Remota)",
  }
  if (companyId) movementPayload.company_id = companyId

  const { error: movementError } = await insertRemoteReturnMovement(supabaseAdmin, movementPayload)
  if (movementError) throw movementError
  if (stockBefore === null) return

  const { data: stockAfterData, error: stockAfterError } = await supabaseAdmin
    .from("ppes")
    .select("current_stock")
    .eq("id", ppeId)
    .maybeSingle()

  if (stockAfterError) throw stockAfterError

  const stockAfter = parseStock((stockAfterData as { current_stock?: unknown } | null)?.current_stock)
  const expectedStock = stockBefore + quantity
  if (stockAfter === expectedStock) return

  let updateQuery = supabaseAdmin
    .from("ppes")
    .update({ current_stock: expectedStock })
    .eq("id", ppeId)

  if (companyId) updateQuery = updateQuery.eq("company_id", companyId)
  const { error: updateError } = await updateQuery
  if (updateError) throw updateError
}

function getDeliveryIdsFromLinkData(data: unknown): string[] {
  if (!data || typeof data !== "object") return []
  const deliveryIds = (data as { deliveryIds?: unknown }).deliveryIds
  if (!Array.isArray(deliveryIds)) return []
  return deliveryIds.filter((id): id is string => isValidUuid(id))
}

function isSignatureOnlyLinkData(data: unknown) {
  return (
    !!data &&
    typeof data === "object" &&
    (data as { signaturePendingOnly?: unknown }).signaturePendingOnly === true
  )
}

function getStringArrayFromLinkData(data: unknown, key: string): string[] {
  if (!data || typeof data !== "object") return []
  const value = (data as Record<string, unknown>)[key]
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function getStringFromLinkData(data: unknown, key: string) {
  if (!data || typeof data !== "object") return ""
  const value = (data as Record<string, unknown>)[key]
  return typeof value === "string" ? value : ""
}

function getDeliveryDateFromLinkData(data: unknown) {
  const value = getStringFromLinkData(data, "deliveryDate")
  if (!value) return new Date().toISOString()

  const parsed = value.includes("T")
    ? new Date(value)
    : new Date(`${value}T12:00:00`)

  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString()
}

export async function POST(req: Request) {
  let claimedLinkId: string | null = null
  let releaseClaimedLink = async () => {}

  const failAfterClaim = async (body: Record<string, unknown>, status: number) => {
    await releaseClaimedLink()
    return NextResponse.json(body, { status })
  }

  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabaseUrl || !serviceRoleKey) {
      console.error("Variáveis de ambiente do Supabase ausentes no servidor.")
      return NextResponse.json({ error: "Configuração do servidor incompleta" }, { status: 500 })
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey)
    releaseClaimedLink = async () => {
      if (!claimedLinkId) return
      try {
        await supabaseAdmin
          .from("remote_links")
          .update({ status: "pending", completed_at: null })
          .eq("id", claimedLinkId)
          .eq("status", "completed")
      } catch (releaseError) {
        console.error("[/api/remote-delivery] claim release error:", releaseError)
      } finally {
        claimedLinkId = null
      }
    }

    const formData = await req.formData()

    const { data: fields } = validateBody(remoteDeliveryFieldsSchema, {
      employee_id: formData.get("employee_id"),
      ppe_id: formData.get("ppe_id"),
      workplace_id: formData.get("workplace_id"),
      third_party_id: formData.get("third_party_id"),
      reason: formData.get("reason") || undefined,
      quantity: formData.get("quantity") || undefined,
      ip_address: formData.get("ip_address") || undefined,
      auth_method: formData.get("auth_method") || undefined,
      token: formData.get("token"),
    })
    const employee_id = fields.employee_id
    const ppe_id = fields.ppe_id
    const workplace_id = fields.workplace_id || null
    const third_party_id_from_form = fields.third_party_id || null
    const reason = normalizeDeliveryReason(fields.reason || "Primeira Entrega")
    const quantity = fields.quantity
    const ip_address = fields.ip_address || ""
    const geo_location = String(formData.get("geo_location") || "").trim()
    const auth_method = fields.auth_method || "manual"
    const signatureFile = formData.get("signatureFile") as File | null
    const token = fields.token
    const rateLimitKey = isValidToken(token)
      ? `remote-delivery:token:${token}`
      : `remote-delivery:ip:${getClientIp(req)}`
    const limited = rateLimit(rateLimitKey, 10, 60 * 60 * 1000)
    if (!limited.success) return rateLimitExceededResponse(limited.retryAfter)

    if (!isValidUuid(employee_id) || !isValidUuid(ppe_id)) {
      return NextResponse.json({ error: "Parâmetros inválidos." }, { status: 400 })
    }

    if (!isValidGeoLocation(geo_location)) {
      return NextResponse.json({
        error: "Localizacao obrigatoria. Permita a localizacao do navegador e tente novamente.",
      }, { status: 400 })
    }

    // Token agora é OBRIGATÓRIO. Sem token não há rota pública pra criar
    // entrega — operações autenticadas usam a rota normal /deliveries.
    if (!isValidToken(token)) {
      return NextResponse.json({ error: "Token inválido." }, { status: 401 })
    }

    if (!signatureFile || !(signatureFile instanceof File) || signatureFile.size === 0) {
      return NextResponse.json({ error: "Arquivo de assinatura nao informado." }, { status: 400 })
    }
    const validatedSignature = await validateUpload(signatureFile, "image")

    const { data: link } = await supabaseAdmin
      .from("remote_links")
      .select("id, employee_id, company_id, type, status, expires_at, data")
      .eq("token", token)
      .maybeSingle()

    if (!link) {
      return NextResponse.json({ error: "Link não encontrado." }, { status: 404 })
    }
    if (link.employee_id !== employee_id) {
      return NextResponse.json({ error: "Link não corresponde ao colaborador." }, { status: 403 })
    }
    if (link.type !== "delivery") {
      return NextResponse.json({ error: "Tipo de link incompatível." }, { status: 403 })
    }
    if (new Date(link.expires_at) < new Date()) {
      await supabaseAdmin.from("remote_links").update({ status: "expired" }).eq("id", link.id)
      return NextResponse.json({ error: "Este link expirou." }, { status: 410 })
    }
    if (link.status !== "pending") {
      return NextResponse.json({ error: "Este link já foi utilizado." }, { status: 410 })
    }

    // Reivindica o link de forma atômica antes de fazer qualquer escrita.
    const { data: claimed, error: claimError } = await supabaseAdmin
      .from("remote_links")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", link.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle()

    if (claimError || !claimed) {
      return NextResponse.json({ error: "Link já consumido por outra requisição." }, { status: 409 })
    }

    claimedLinkId = claimed.id

    const companyId = link.company_id || null
    const third_party_id = isValidUuid(third_party_id_from_form)
      ? third_party_id_from_form
      : getStringFromLinkData(link.data, "thirdPartyId")
    const deliveryDateFromLink = getDeliveryDateFromLinkData(link.data)

    let signatureUrl: string | null = null
    if (signatureFile.size > 0) {
      const prefix = auth_method === "facial" ? "bio_" : "sig_"
      const extension = validatedSignature.extension
      const safeCompanyPrefix = companyId || "remote"
      const fileName = `${safeCompanyPrefix}/signatures/${prefix}${Date.now()}_${employee_id}.${extension}`
      const { error: storageError } = await supabaseAdmin.storage
        .from(PRIVATE_STORAGE_BUCKET)
        .upload(fileName, validatedSignature.buffer, {
          contentType: validatedSignature.contentType,
          upsert: false,
        })

      if (storageError) {
        console.error("[/api/remote-delivery] storage error:", storageError)
        return failAfterClaim({ error: "Falha ao salvar assinatura." }, 500)
      }

      signatureUrl = fileName
    }

    // Confirma que o ppe pertence à mesma empresa do link.
    const signatureOnlyDeliveryIds = getDeliveryIdsFromLinkData(link.data)
    if (isSignatureOnlyLinkData(link.data) && signatureOnlyDeliveryIds.length > 0) {
      const { data: existingDeliveries, error: existingError } = await supabaseAdmin
        .from("deliveries")
        .select("id, employee_id, company_id, ppe_id, quantity, reason, delivery_date")
        .in("id", signatureOnlyDeliveryIds)

      if (existingError) {
        console.error("[/api/remote-delivery] existing delivery fetch error:", existingError)
        return failAfterClaim({ error: "Falha ao localizar entregas pendentes de assinatura." }, 500)
      }

      const validDeliveries = (existingDeliveries || []).filter((delivery: { employee_id?: string; company_id?: string | null }) =>
        delivery.employee_id === employee_id &&
        (!companyId || !delivery.company_id || delivery.company_id === companyId)
      )

      if (validDeliveries.length !== signatureOnlyDeliveryIds.length) {
        return failAfterClaim({ error: "Entrega pendente nao pertence ao colaborador ou empresa do link." }, 403)
      }

      const updatePayload: Record<string, unknown> = {
        signature_url: signatureUrl,
        auth_method,
        ip_address,
      }
      if (isValidUuid(third_party_id)) updatePayload.third_party_id = third_party_id
      if (isValidUuid(workplace_id)) updatePayload.workplace_id = workplace_id

      const { data: updatedDeliveries, error: updateError } = await supabaseAdmin
        .from("deliveries")
        .update(updatePayload)
        .in("id", signatureOnlyDeliveryIds)
        .select()

      if (updateError && isDeliverySchemaCompatibilityIssue(updateError)) {
        const fallbackPayloads: Record<string, unknown>[] = [
          {
            signature_url: signatureUrl,
            ip_address,
            ...(isValidUuid(third_party_id) ? { third_party_id } : {}),
            ...(isValidUuid(workplace_id) ? { workplace_id } : {}),
          },
          {
            signature_url: signatureUrl,
            ip_address,
            ...(isValidUuid(third_party_id) ? { third_party_id } : {}),
          },
          { signature_url: signatureUrl, ip_address },
        ]
        let fallbackUpdated: DeliveryInsertRow[] | null = null
        let fallbackUpdateError: unknown = null

        for (const payload of fallbackPayloads) {
          const fallbackResult = await supabaseAdmin
            .from("deliveries")
            .update(payload)
            .in("id", signatureOnlyDeliveryIds)
            .select()

          fallbackUpdated = fallbackResult.data as DeliveryInsertRow[] | null
          fallbackUpdateError = fallbackResult.error
          if (!fallbackUpdateError) break
          if (!isDeliverySchemaCompatibilityIssue(fallbackUpdateError)) break
        }

        if (fallbackUpdateError) {
          console.error("[/api/remote-delivery] fallback signature update error:", fallbackUpdateError)
          return failAfterClaim({ error: "Falha ao salvar assinatura na entrega existente." }, 500)
        }

        return NextResponse.json({
          success: true,
          data: fallbackUpdated?.[0] || validDeliveries[0],
          deliveries: fallbackUpdated || validDeliveries,
          deliveryIds: signatureOnlyDeliveryIds,
          signatureOnly: true,
          autoReturnedDeliveryIds: getStringArrayFromLinkData(link.data, "autoReturnedDeliveryIds"),
        })
      }

      if (updateError) {
        console.error("[/api/remote-delivery] signature update error:", updateError)
        return failAfterClaim({ error: "Falha ao salvar assinatura na entrega existente." }, 500)
      }

      return NextResponse.json({
        success: true,
        data: updatedDeliveries?.[0] || validDeliveries[0],
        deliveries: updatedDeliveries || validDeliveries,
        deliveryIds: signatureOnlyDeliveryIds,
        signatureOnly: true,
        autoReturnedDeliveryIds: getStringArrayFromLinkData(link.data, "autoReturnedDeliveryIds"),
      })
    }

    const { data: ppe } = await supabaseAdmin
      .from("ppes")
      .select("id, company_id, current_stock")
      .eq("id", ppe_id)
      .maybeSingle()

    if (!ppe || (companyId && ppe.company_id && ppe.company_id !== companyId)) {
      return failAfterClaim({ error: "EPI não pertence à empresa do link." }, 403)
    }

    const stockBefore =
      typeof ppe.current_stock === "number" ? ppe.current_stock : null

    const baseInsertPayload: Record<string, unknown> = {
      employee_id,
      ppe_id,
      workplace_id: workplace_id === "null" || !workplace_id ? null : workplace_id,
      third_party_id: isValidUuid(third_party_id) ? third_party_id : null,
      reason,
      quantity,
      ip_address,
      signature_url: signatureUrl,
      auth_method,
      delivery_date: deliveryDateFromLink,
    }
    if (companyId) baseInsertPayload.company_id = companyId

    let data: DeliveryInsertRow[] | null = null
    let error: unknown = null

    for (const reasonVariant of getDeliveryReasonStorageVariants(reason)) {
      const insertPayload: Record<string, unknown> = {
        ...baseInsertPayload,
        reason: reasonVariant,
      }

      const insertResult = await supabaseAdmin
        .from("deliveries")
        .insert([insertPayload])
        .select()

      data = insertResult.data
      error = insertResult.error

      if (!error) break

      if (isDeliverySchemaCompatibilityIssue(error)) {
        const fallbackPayloads: Record<string, unknown>[] = [
          {
            ...(companyId ? { company_id: companyId } : {}),
            employee_id,
            ppe_id,
            workplace_id: insertPayload.workplace_id,
            third_party_id: insertPayload.third_party_id,
            reason: reasonVariant,
            quantity,
            ip_address,
            signature_url: signatureUrl,
            delivery_date: insertPayload.delivery_date,
          },
          {
            ...(companyId ? { company_id: companyId } : {}),
            employee_id,
            ppe_id,
            third_party_id: insertPayload.third_party_id,
            reason: reasonVariant,
            quantity,
            ip_address,
            signature_url: signatureUrl,
            delivery_date: insertPayload.delivery_date,
          },
          {
            ...(companyId ? { company_id: companyId } : {}),
            employee_id,
            ppe_id,
            reason: reasonVariant,
            quantity,
            ip_address,
            signature_url: signatureUrl,
            delivery_date: insertPayload.delivery_date,
          },
        ]

        for (const fallbackPayload of fallbackPayloads) {
          const fallbackResult = await supabaseAdmin
            .from("deliveries")
            .insert([fallbackPayload])
            .select()
          data = fallbackResult.data
          error = fallbackResult.error

          if (!error) break
          if (!isDeliverySchemaCompatibilityIssue(error)) break
        }

        if (!error) break
      }

      if (!isDeliveryReasonConstraintIssue(error)) break
    }

    if (error) {
      console.error("[/api/remote-delivery] insert error:", error)
      return failAfterClaim({ error: "Falha ao registrar entrega." }, 500)
    }

    const savedDelivery = data?.[0]
    if (!savedDelivery || typeof savedDelivery.id !== "string") {
      return failAfterClaim({ error: "Entrega não retornou registro." }, 500)
    }

    const autoReturnedDeliveryIds: string[] = []
    if (shouldAutoReturnReason(reason)) {
      let activeSamePpeQuery = supabaseAdmin
        .from("deliveries")
        .select("id, quantity, returned_quantity")
        .eq("employee_id", employee_id)
        .eq("ppe_id", ppe_id)
        .is("returned_at", null)
        .neq("id", savedDelivery.id)

      if (companyId) activeSamePpeQuery = activeSamePpeQuery.eq("company_id", companyId)
      const { data: activeSamePpe, error: activeSamePpeError } = await activeSamePpeQuery

      if (activeSamePpeError) {
        console.warn("[/api/remote-delivery] auto-return fetch error:", activeSamePpeError)
      } else {
        const returnMotive = getAutoReturnMotive(reason)
        const returnedAt = new Date().toISOString()

        for (const previousDelivery of activeSamePpe || []) {
          const previousDeliveryId = (previousDelivery as { id?: unknown }).id
          if (!isValidUuid(previousDeliveryId)) continue

          const totalQuantity = Number((previousDelivery as { quantity?: unknown }).quantity || 0)
          const alreadyReturned = Number((previousDelivery as { returned_quantity?: unknown }).returned_quantity || 0)
          const quantityToReturn = Math.max(0, totalQuantity - alreadyReturned)
          if (quantityToReturn <= 0) continue

          const updatePayload = {
            returned_quantity: totalQuantity,
            returned_at: returnedAt,
            return_motive: returnMotive,
          }
          const { error: returnError } = await supabaseAdmin
            .from("deliveries")
            .update(updatePayload)
            .eq("id", previousDeliveryId)

          if (returnError && isMissingReturnMotiveIssue(returnError)) {
            await supabaseAdmin
              .from("deliveries")
              .update({ returned_quantity: totalQuantity, returned_at: returnedAt })
              .eq("id", previousDeliveryId)
          } else if (returnError) {
            console.warn("[/api/remote-delivery] auto-return update error:", returnError)
            continue
          }

          if (shouldRestockReturnedDelivery(returnMotive)) {
            try {
              await restockRemoteReturnedPpe(
                supabaseAdmin as unknown as SupabaseAdminClient,
                ppe_id,
                companyId,
                quantityToReturn,
                returnMotive,
                previousDeliveryId,
              )
            } catch (restockError) {
              console.warn("[/api/remote-delivery] auto-return restock error:", restockError)
            }
          }

          autoReturnedDeliveryIds.push(previousDeliveryId)
        }
      }
    }

    // Sincroniza estoque se o trigger não fez (mesma lógica anterior).
    if (stockBefore !== null) {
      const { data: afterStockData } = await supabaseAdmin
        .from("ppes")
        .select("current_stock")
        .eq("id", ppe_id)
        .maybeSingle()

      const stockAfterInsert =
        typeof afterStockData?.current_stock === "number"
          ? afterStockData.current_stock
          : null
      const desiredStock = Math.max(0, stockBefore - quantity)

      if (stockAfterInsert !== null && stockAfterInsert > desiredStock) {
        const missingOut = stockAfterInsert - desiredStock
        const movementPayload: Record<string, unknown> = {
          ppe_id,
          delivery_id: savedDelivery.id,
          quantity: missingOut,
          type: "SAIDA",
          motive: `Entrega remota (${reason})`,
          created_by_name: "Sistema (Entrega Remota)",
        }
        if (companyId) movementPayload.company_id = companyId

        const { error: movementError } = await supabaseAdmin
          .from("stock_movements")
          .insert([movementPayload])

        if (movementError) {
          const text = `${movementError.message || ""} ${movementError.details || ""}`.toLowerCase()
          const { delivery_id: _deliveryId, ...movementWithoutDeliveryId } = movementPayload
          void _deliveryId

          if (isMissingDeliveryIdColumnIssue(movementError)) {
            await supabaseAdmin
              .from("stock_movements")
              .insert([movementWithoutDeliveryId])
            return NextResponse.json({ success: true, data: savedDelivery, autoReturnedDeliveryIds })
          }

          const missingCreatedByColumns =
            movementError.code === "PGRST204" ||
            movementError.code === "42703" ||
            text.includes("created_by_name") ||
            text.includes("created_by_id")

          if (missingCreatedByColumns) {
            const fallbackMovement = {
              ...(companyId ? { company_id: companyId } : {}),
              ppe_id,
              delivery_id: savedDelivery.id,
              quantity: missingOut,
              type: "SAIDA",
              motive: `Entrega remota (${reason})`,
            }
            const { error: fallbackMovementError } = await supabaseAdmin
              .from("stock_movements")
              .insert([fallbackMovement])

            if (fallbackMovementError && isMissingDeliveryIdColumnIssue(fallbackMovementError)) {
              const { delivery_id: _fallbackDeliveryId, ...fallbackWithoutDeliveryId } = fallbackMovement
              void _fallbackDeliveryId
              await supabaseAdmin.from("stock_movements").insert([fallbackWithoutDeliveryId])
            }
          }
        }
      }
    }

    return NextResponse.json({ success: true, data: savedDelivery, autoReturnedDeliveryIds })
  } catch (error: unknown) {
    if (isValidationResponse(error)) return error
    console.error("[/api/remote-delivery] unexpected error:", error)
    await releaseClaimedLink()
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}
