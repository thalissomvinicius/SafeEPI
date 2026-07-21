import { NextRequest, NextResponse } from "next/server"
import { requireAuthorizedUser } from "@/lib/serverAuth"
import { supabaseAdmin } from "@/lib/supabaseAdmin"

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

    const { data, error } = await supabaseAdmin.rpc("safeepi_return_delivery", {
      p_company_id: companyId,
      p_delivery_id: deliveryId,
      p_quantity: requestedQuantity,
      p_motive: motive,
      p_restock: shouldRestockReturnedDelivery(motive),
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
