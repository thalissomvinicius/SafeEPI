import { NextRequest, NextResponse } from "next/server"
import { requireAuthorizedUser } from "@/lib/serverAuth"
import { supabaseAdmin } from "@/lib/supabaseAdmin"

type SupabaseLikeError = {
  code?: string
  details?: string | null
  hint?: string | null
  message?: string
}

function resolveCompanyId(authUser: { role: string; company_id: string | null }, requestedCompanyId: unknown) {
  if (authUser.role === "MASTER") return typeof requestedCompanyId === "string" && requestedCompanyId ? requestedCompanyId : null
  return authUser.company_id
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

function parseStock(raw: unknown): number | null {
  if (typeof raw === "number") return raw
  if (typeof raw === "string") {
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

function isMissingDeliveryReturnMotiveIssue(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const maybeError = error as SupabaseLikeError
  const text = `${maybeError.message || ""} ${maybeError.details || ""} ${maybeError.hint || ""}`.toLowerCase()
  return (
    maybeError.code === "PGRST204" &&
    text.includes("return_motive")
  ) || (
    maybeError.code === "42703" &&
    text.includes("return_motive")
  )
}

function isMissingDeliveryIdIssue(error: SupabaseLikeError) {
  const text = `${error.message || ""} ${error.details || ""} ${error.hint || ""}`.toLowerCase()
  return (
    error.code === "PGRST204" ||
    error.code === "42703" ||
    text.includes("schema cache") ||
    text.includes("could not find") ||
    text.includes("column")
  ) && text.includes("delivery_id")
}

async function insertReturnMovement(payload: Record<string, unknown>) {
  const firstTry = await supabaseAdmin
    .from("stock_movements")
    .insert([payload])
    .select()

  if (!firstTry.error) return firstTry
  if (!isMissingDeliveryIdIssue(firstTry.error)) return firstTry

  const fallback = { ...payload }
  delete fallback.delivery_id
  return supabaseAdmin.from("stock_movements").insert([fallback]).select()
}

async function restockPpe(
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
  }
  if (companyId) movementPayload.company_id = companyId

  const { error: movementError } = await insertReturnMovement(movementPayload)
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

  const updateQuery = supabaseAdmin
    .from("ppes")
    .update({ current_stock: expectedStock })
    .eq("id", ppeId)

  if (companyId) updateQuery.eq("company_id", companyId)
  const { error: updateError } = await updateQuery
  if (updateError) throw updateError
}

export async function POST(request: NextRequest) {
  const auth = await requireAuthorizedUser(request, ["MASTER", "ADMIN", "ALMOXARIFE"])
  if (!auth.authorized) return auth.response

  try {
    const body = await request.json()
    const deliveryId = typeof body.deliveryId === "string" ? body.deliveryId : ""
    const motive = typeof body.motive === "string" ? body.motive.trim() : ""
    const requestedQuantity = body.quantity === undefined || body.quantity === null ? null : Number(body.quantity)
    const companyId = resolveCompanyId(auth.user, body.company_id)

    if (!deliveryId) {
      return NextResponse.json({ error: "ID da entrega e obrigatorio." }, { status: 400 })
    }

    if (!motive) {
      return NextResponse.json({ error: "Motivo da devolucao e obrigatorio." }, { status: 400 })
    }

    if (!companyId) {
      return NextResponse.json({ error: "Empresa atual nao encontrada para este usuario." }, { status: 400 })
    }

    const deliveryQuery = supabaseAdmin
      .from("deliveries")
      .select("id, company_id, ppe_id, quantity, returned_quantity, returned_at")
      .eq("id", deliveryId)
      .eq("company_id", companyId)

    const { data: delivery, error: fetchError } = await deliveryQuery.maybeSingle()

    if (fetchError) {
      console.error("[API deliveries/return] Fetch error:", fetchError)
      return NextResponse.json({ error: "Erro interno, tente novamente" }, { status: 500 })
    }

    if (!delivery) {
      return NextResponse.json({ error: "Entrega nao encontrada para a empresa atual." }, { status: 404 })
    }

    const totalQuantity = Number(delivery.quantity || 0)
    const alreadyReturned = Number(delivery.returned_quantity || 0)
    const remaining = Math.max(0, totalQuantity - alreadyReturned)
    const quantityToReturn = requestedQuantity === null
      ? (delivery.returned_at ? 0 : remaining)
      : Math.min(Math.max(0, requestedQuantity), remaining)

    if (quantityToReturn <= 0) {
      return NextResponse.json({ ok: true, returned_quantity: alreadyReturned })
    }

    const nextReturnedQuantity = Math.min(totalQuantity, alreadyReturned + quantityToReturn)
    const shouldClose = nextReturnedQuantity >= totalQuantity
    const updatePayload = {
      returned_quantity: nextReturnedQuantity,
      return_motive: motive,
      ...(shouldClose ? { returned_at: new Date().toISOString() } : {}),
    }

    const firstUpdate = await supabaseAdmin
      .from("deliveries")
      .update(updatePayload)
      .eq("id", deliveryId)
      .eq("company_id", companyId)
      .select("id, returned_quantity, returned_at")
      .maybeSingle()

    if (firstUpdate.error) {
      if (!isMissingDeliveryReturnMotiveIssue(firstUpdate.error)) {
        console.error("[API deliveries/return] Update error:", firstUpdate.error)
        return NextResponse.json({ error: "Erro interno, tente novamente" }, { status: 500 })
      }

      const fallbackUpdate = await supabaseAdmin
        .from("deliveries")
        .update(shouldClose ? { returned_at: new Date().toISOString() } : { returned_quantity: nextReturnedQuantity })
        .eq("id", deliveryId)
        .eq("company_id", companyId)
        .select("id, returned_quantity, returned_at")
        .maybeSingle()

      if (fallbackUpdate.error) {
        console.error("[API deliveries/return] Fallback update error:", fallbackUpdate.error)
        return NextResponse.json({ error: "Erro interno, tente novamente" }, { status: 500 })
      }
    }

    if (delivery.ppe_id && shouldRestockReturnedDelivery(motive)) {
      await restockPpe(delivery.ppe_id as string, companyId, quantityToReturn, motive, deliveryId)
    }

    return NextResponse.json({
      ok: true,
      returned_quantity: nextReturnedQuantity,
      quantity_returned_now: quantityToReturn,
    })
  } catch (err) {
    console.error("[API deliveries/return] Unexpected error:", err)
    return NextResponse.json({ error: "Erro interno ao devolver entrega." }, { status: 500 })
  }
}
