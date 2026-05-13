import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

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
    (text.includes("column") && (text.includes("auth_method") || text.includes("workplace_id")))
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

function isDeliveryReasonConstraintIssue(error: unknown) {
  if (!error || typeof error !== "object") return false
  const maybeError = error as SupabaseLikeError
  const text = `${maybeError.message || ""} ${maybeError.details || ""}`.toLowerCase()
  return maybeError.code === "23514" && (text.includes("reason") || text.includes("deliveries"))
}

function shouldAutoReturnReason(reason: string) {
  return reason !== "Primeira Entrega"
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

export async function POST(req: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabaseUrl || !serviceRoleKey) {
      console.error("Variáveis de ambiente do Supabase ausentes no servidor.")
      return NextResponse.json({ error: "Configuração do servidor incompleta" }, { status: 500 })
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey)

    const formData = await req.formData()

    const employee_id = formData.get("employee_id") as string
    const ppe_id = formData.get("ppe_id") as string
    const workplace_id = formData.get("workplace_id") as string | null
    const reason = normalizeDeliveryReason((formData.get("reason") as string) || "Primeira Entrega")
    const quantityRaw = Number(formData.get("quantity"))
    const quantity = Number.isFinite(quantityRaw) && quantityRaw > 0 && quantityRaw <= 1000
      ? Math.floor(quantityRaw)
      : 1
    const ip_address = formData.get("ip_address") as string
    const auth_method = (formData.get("auth_method") as string) || "manual"
    const signatureFile = formData.get("signatureFile") as File | null
    const token = formData.get("token") as string | null

    if (!isValidUuid(employee_id) || !isValidUuid(ppe_id)) {
      return NextResponse.json({ error: "Parâmetros inválidos." }, { status: 400 })
    }

    // Token agora é OBRIGATÓRIO. Sem token não há rota pública pra criar
    // entrega — operações autenticadas usam a rota normal /deliveries.
    if (!isValidToken(token)) {
      return NextResponse.json({ error: "Token inválido." }, { status: 401 })
    }

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

    const companyId = link.company_id || null

    let signatureUrl: string | null = null
    if (signatureFile && signatureFile.size > 0) {
      // Limita tamanho a ~3 MB.
      if (signatureFile.size > 3 * 1024 * 1024) {
        return NextResponse.json({ error: "Arquivo de assinatura excede 3MB." }, { status: 413 })
      }
      const prefix = auth_method === "facial" ? "bio_" : "sig_"
      const fileName = `${prefix}${Date.now()}_${employee_id}.png`
      const { error: storageError } = await supabaseAdmin.storage
        .from("ppe_signatures")
        .upload(fileName, signatureFile)

      if (storageError) {
        console.error("[/api/remote-delivery] storage error:", storageError)
        return NextResponse.json({ error: "Falha ao salvar assinatura." }, { status: 500 })
      }

      const { data: { publicUrl } } = supabaseAdmin.storage
        .from("ppe_signatures")
        .getPublicUrl(fileName)

      signatureUrl = publicUrl
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
        return NextResponse.json({ error: "Falha ao localizar entregas pendentes de assinatura." }, { status: 500 })
      }

      const validDeliveries = (existingDeliveries || []).filter((delivery: { employee_id?: string; company_id?: string | null }) =>
        delivery.employee_id === employee_id &&
        (!companyId || !delivery.company_id || delivery.company_id === companyId)
      )

      if (validDeliveries.length !== signatureOnlyDeliveryIds.length) {
        return NextResponse.json({ error: "Entrega pendente nao pertence ao colaborador ou empresa do link." }, { status: 403 })
      }

      const updatePayload: Record<string, unknown> = {
        signature_url: signatureUrl,
        auth_method,
        ip_address,
      }

      const { data: updatedDeliveries, error: updateError } = await supabaseAdmin
        .from("deliveries")
        .update(updatePayload)
        .in("id", signatureOnlyDeliveryIds)
        .select()

      if (updateError && isDeliverySchemaCompatibilityIssue(updateError)) {
        const { data: fallbackUpdated, error: fallbackUpdateError } = await supabaseAdmin
          .from("deliveries")
          .update({ signature_url: signatureUrl, ip_address })
          .in("id", signatureOnlyDeliveryIds)
          .select()

        if (fallbackUpdateError) {
          console.error("[/api/remote-delivery] fallback signature update error:", fallbackUpdateError)
          return NextResponse.json({ error: "Falha ao salvar assinatura na entrega existente." }, { status: 500 })
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
        return NextResponse.json({ error: "Falha ao salvar assinatura na entrega existente." }, { status: 500 })
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
      return NextResponse.json({ error: "EPI não pertence à empresa do link." }, { status: 403 })
    }

    const stockBefore =
      typeof ppe.current_stock === "number" ? ppe.current_stock : null

    const baseInsertPayload: Record<string, unknown> = {
      employee_id,
      ppe_id,
      workplace_id: workplace_id === "null" || !workplace_id ? null : workplace_id,
      reason,
      quantity,
      ip_address,
      signature_url: signatureUrl,
      auth_method,
      delivery_date: new Date().toISOString(),
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
        const fallbackPayload = {
          ...(companyId ? { company_id: companyId } : {}),
          employee_id,
          ppe_id,
          reason: reasonVariant,
          quantity,
          ip_address,
          signature_url: signatureUrl,
          delivery_date: insertPayload.delivery_date,
        }
        const fallbackResult = await supabaseAdmin
          .from("deliveries")
          .insert([fallbackPayload])
          .select()
        data = fallbackResult.data
        error = fallbackResult.error

        if (!error) break
      }

      if (!isDeliveryReasonConstraintIssue(error)) break
    }

    if (error) {
      console.error("[/api/remote-delivery] insert error:", error)
      return NextResponse.json({ error: "Falha ao registrar entrega." }, { status: 500 })
    }

    const savedDelivery = data?.[0]
    if (!savedDelivery || typeof savedDelivery.id !== "string") {
      return NextResponse.json({ error: "Entrega não retornou registro." }, { status: 500 })
    }

    let autoReturnedDeliveryIds: string[] = []
    if (shouldAutoReturnReason(reason)) {
      const { data: activeSamePpe } = await supabaseAdmin
        .from("deliveries")
        .select("id")
        .eq("employee_id", employee_id)
        .eq("ppe_id", ppe_id)
        .is("returned_at", null)
        .neq("id", savedDelivery.id)

      const previousDeliveryIds = (activeSamePpe || [])
        .map((item: { id?: string }) => item.id)
        .filter((id): id is string => Boolean(id))

      if (previousDeliveryIds.length > 0) {
        const returnedAt = new Date().toISOString()
        const { error: returnError } = await supabaseAdmin
          .from("deliveries")
          .update({ returned_at: returnedAt, return_motive: getAutoReturnMotive(reason) })
          .in("id", previousDeliveryIds)

        if (returnError && isMissingReturnMotiveIssue(returnError)) {
          await supabaseAdmin
            .from("deliveries")
            .update({ returned_at: returnedAt })
            .in("id", previousDeliveryIds)
        }
        autoReturnedDeliveryIds = previousDeliveryIds
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
          const missingCreatedByColumns =
            movementError.code === "PGRST204" ||
            movementError.code === "42703" ||
            text.includes("created_by_name") ||
            text.includes("created_by_id")

          if (missingCreatedByColumns) {
            await supabaseAdmin.from("stock_movements").insert([
              {
                ...(companyId ? { company_id: companyId } : {}),
                ppe_id,
                quantity: missingOut,
                type: "SAIDA",
                motive: `Entrega remota (${reason})`,
              },
            ])
          }
        }
      }
    }

    return NextResponse.json({ success: true, data: savedDelivery, autoReturnedDeliveryIds })
  } catch (error: unknown) {
    console.error("[/api/remote-delivery] unexpected error:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}
