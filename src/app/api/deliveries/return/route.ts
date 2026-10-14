import { NextRequest, NextResponse } from "next/server"
import { requireAuthorizedUser } from "@/lib/serverAuth"
import { supabaseAdmin } from "@/lib/supabaseAdmin"
import { canRestockReturn } from "@/lib/returnWorkflow"

function resolveCompanyId(authUser: { role: string; company_id: string | null }, requestedCompanyId: unknown) {
  if (authUser.role === "MASTER") return typeof requestedCompanyId === "string" && requestedCompanyId ? requestedCompanyId : null
  return authUser.company_id
}

export async function POST(request: NextRequest) {
  const auth = await requireAuthorizedUser(request, ["MASTER", "ADMIN", "ALMOXARIFE"])
  if (!auth.authorized) return auth.response

  try {
    const body = await request.json()
    const deliveryId = typeof body.deliveryId === "string" ? body.deliveryId : ""
    const motive = typeof body.motive === "string" ? body.motive.trim() : ""
    const requestedQuantity = body.quantity === undefined || body.quantity === null ? null : Number(body.quantity)
    const expectedReturned = body.expected_returned_quantity === undefined ? null : Number(body.expected_returned_quantity)
    const employeeId = typeof body.employee_id === "string" ? body.employee_id : null
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

    if ((requestedQuantity !== null && (!Number.isSafeInteger(requestedQuantity) || requestedQuantity <= 0)) ||
        (expectedReturned !== null && (!Number.isSafeInteger(expectedReturned) || expectedReturned < 0)) ||
        (body.restock !== undefined && typeof body.restock !== "boolean") || motive.length > 150) {
      return NextResponse.json({ error: "Quantidade, destino ou motivo da baixa inválido." }, { status: 400 })
    }
    if (body.restock === true && !canRestockReturn(motive)) {
      return NextResponse.json({ error: "Itens com desgaste, vencimento, dano ou perda não podem voltar ao estoque disponível." }, { status: 400 })
    }

    const { data: delivery, error: lookupError } = await supabaseAdmin.from("deliveries")
      .select("id, employee_id, quantity, returned_quantity, returned_at")
      .eq("id", deliveryId).eq("company_id", companyId).is("deleted_at", null).maybeSingle()
    if (lookupError) return NextResponse.json({ error: "Não foi possível conferir a entrega. Tente novamente." }, { status: 503 })
    if (!delivery || (employeeId && delivery.employee_id !== employeeId)) {
      return NextResponse.json({ error: "Entrega não encontrada para o colaborador e a empresa atuais." }, { status: 404 })
    }
    const returnedQuantity = Number(delivery.returned_quantity || 0)
    if (expectedReturned !== null && expectedReturned !== returnedQuantity) {
      return NextResponse.json({ error: "O saldo da entrega mudou. Confira o histórico antes de tentar novamente.", code: "RETURN_STATE_CHANGED", returned_quantity: returnedQuantity }, { status: 409 })
    }
    const remaining = Math.max(0, Number(delivery.quantity) - returnedQuantity)
    if (requestedQuantity !== null && remaining > 0 && requestedQuantity > remaining) {
      return NextResponse.json({ error: "A quantidade solicitada excede o saldo em posse do colaborador." }, { status: 409 })
    }

    const { data, error } = await supabaseAdmin.rpc("safeepi_return_delivery", {
      p_company_id: companyId,
      p_delivery_id: deliveryId,
      p_quantity: requestedQuantity,
      p_motive: motive,
      p_restock: body.restock === true,
      p_created_by_id: auth.user.id,
      p_created_by_name: auth.user.email || "Usuario SafeEPI",
    })

    if (error) {
      const status = error.message.includes("delivery_not_found") ? 404 : 500
      console.error("[API deliveries/return] Atomic return error:", error)
      return NextResponse.json({
        error: status === 404 ? "Entrega nao encontrada para a empresa atual." : "Erro interno, tente novamente",
      }, { status })
    }

    return NextResponse.json(data)
  } catch (err) {
    console.error("[API deliveries/return] Unexpected error:", err)
    return NextResponse.json({ error: "Erro interno ao devolver entrega." }, { status: 500 })
  }
}
