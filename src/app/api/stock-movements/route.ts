import { NextRequest, NextResponse } from "next/server"
import { requireAuthorizedUser } from "@/lib/serverAuth"
import { supabaseAdmin } from "@/lib/supabaseAdmin"

type MovementType = "ENTRADA" | "SAIDA" | "AJUSTE"

const VALID_MOVEMENT_TYPES = new Set<MovementType>(["ENTRADA", "SAIDA", "AJUSTE"])

function resolveCompanyId(authUser: { role: string; company_id: string | null }, requestedCompanyId: unknown) {
  if (authUser.role === "MASTER") {
    return typeof requestedCompanyId === "string" && requestedCompanyId ? requestedCompanyId : null
  }

  return authUser.company_id
}

function parseStock(raw: unknown): number | null {
  if (typeof raw === "number") return raw
  if (typeof raw === "string") {
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

function getExpectedStockAfterMovement(currentStock: number, movementType: MovementType, quantity: number): number {
  if (movementType === "AJUSTE") return Math.max(0, quantity)
  if (movementType === "SAIDA") return Math.max(0, currentStock - quantity)
  return currentStock + quantity
}

function isMissingCreatedByIssue(error: { code?: string; message?: string; details?: string }) {
  const text = `${error.message || ""} ${error.details || ""}`.toLowerCase()
  return (
    error.code === "PGRST204" ||
    error.code === "42703" ||
    text.includes("created_by_id") ||
    text.includes("created_by_name")
  )
}

async function insertMovement(payload: Record<string, unknown>) {
  const firstTry = await supabaseAdmin
    .from("stock_movements")
    .insert([payload])
    .select()

  if (!firstTry.error) return firstTry
  if (!isMissingCreatedByIssue(firstTry.error)) return firstTry

  const {
    created_by_id: _createdById,
    created_by_name: _createdByName,
    ...fallbackPayload
  } = payload

  return supabaseAdmin
    .from("stock_movements")
    .insert([fallbackPayload])
    .select()
}

export async function POST(request: NextRequest) {
  const auth = await requireAuthorizedUser(request, ["MASTER", "ADMIN", "ALMOXARIFE"])
  if (!auth.authorized) {
    return auth.response
  }

  try {
    const body = await request.json()
    const ppeId = typeof body.ppe_id === "string" ? body.ppe_id : ""
    const quantity = Number(body.quantity)
    const type = body.type as MovementType
    const motive = typeof body.motive === "string" ? body.motive : null
    const requestedCompanyId = resolveCompanyId(auth.user, body.company_id)

    if (!ppeId) {
      return NextResponse.json({ error: "EPI/CA obrigatorio para movimentar estoque." }, { status: 400 })
    }

    if (!VALID_MOVEMENT_TYPES.has(type)) {
      return NextResponse.json({ error: "Tipo de movimentacao de estoque invalido." }, { status: 400 })
    }

    if (!Number.isFinite(quantity) || quantity < 0 || (type !== "AJUSTE" && quantity <= 0)) {
      return NextResponse.json({ error: "Quantidade de estoque invalida para esta movimentacao." }, { status: 400 })
    }

    if (auth.user.role !== "MASTER" && !requestedCompanyId) {
      return NextResponse.json({ error: "Empresa atual nao encontrada para este usuario." }, { status: 400 })
    }

    let ppeQuery = supabaseAdmin
      .from("ppes")
      .select("current_stock, company_id")
      .eq("id", ppeId)

    if (requestedCompanyId) ppeQuery = ppeQuery.eq("company_id", requestedCompanyId)

    const { data: ppe, error: ppeError } = await ppeQuery.maybeSingle()

    if (ppeError) {
      return NextResponse.json({ error: ppeError.message, code: ppeError.code, details: ppeError.details }, { status: 500 })
    }

    if (!ppe) {
      return NextResponse.json({ error: "EPI/CA nao encontrado para a empresa atual." }, { status: 404 })
    }

    const stockBefore = parseStock((ppe as { current_stock?: unknown }).current_stock)
    const companyId = requestedCompanyId || (ppe as { company_id?: string | null }).company_id || null
    const payload: Record<string, unknown> = {
      ppe_id: ppeId,
      quantity,
      type,
      motive,
    }

    if (companyId) payload.company_id = companyId
    if (typeof body.created_by_id === "string" && body.created_by_id) payload.created_by_id = body.created_by_id
    if (typeof body.created_by_name === "string" && body.created_by_name) payload.created_by_name = body.created_by_name

    const { data, error } = await insertMovement(payload)

    if (error) {
      return NextResponse.json({ error: error.message, code: error.code, details: error.details }, { status: 500 })
    }

    if (stockBefore !== null) {
      const expectedStock = getExpectedStockAfterMovement(stockBefore, type, quantity)
      const { data: stockAfterData, error: stockAfterError } = await supabaseAdmin
        .from("ppes")
        .select("current_stock")
        .eq("id", ppeId)
        .maybeSingle()

      if (stockAfterError) {
        return NextResponse.json({ error: stockAfterError.message, code: stockAfterError.code, details: stockAfterError.details }, { status: 500 })
      }

      const stockAfter = parseStock((stockAfterData as { current_stock?: unknown } | null)?.current_stock)

      if (stockAfter !== expectedStock) {
        const { error: updateError } = await supabaseAdmin
          .from("ppes")
          .update({ current_stock: expectedStock })
          .eq("id", ppeId)

        if (updateError) {
          return NextResponse.json({ error: updateError.message, code: updateError.code, details: updateError.details }, { status: 500 })
        }
      }
    }

    return NextResponse.json({ data: data?.[0] || null })
  } catch (err) {
    console.error("[API stock-movements] Unexpected error:", err)
    return NextResponse.json({ error: "Erro interno ao movimentar estoque." }, { status: 500 })
  }
}
