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

export async function GET(request: NextRequest) {
  const auth = await requireAuthorizedUser(request, ["MASTER", "ADMIN", "ALMOXARIFE", "DIRETORIA"])
  if (!auth.authorized) {
    return auth.response
  }

  try {
    const { searchParams } = new URL(request.url)
    const companyId = resolveCompanyId(auth.user, searchParams.get("company_id"))

    if (auth.user.role !== "MASTER" && !companyId) {
      return NextResponse.json({ error: "Empresa atual nao encontrada para este usuario." }, { status: 400 })
    }

    let query = supabaseAdmin
      .from("stock_movements")
      .select("*, ppe:ppes(name, active)")
      .order("created_at", { ascending: false })
      .limit(500)

    if (companyId) query = query.eq("company_id", companyId)

    const { data, error } = await query

    if (error) {
      console.error("[API stock-movements] List error:", error)
      return NextResponse.json({ error: "Erro interno, tente novamente" }, { status: 500 })
    }

    const movements = (data || []).filter((movement) => !movement.ppe || movement.ppe.active !== false)
    return NextResponse.json({ movements })
  } catch (err) {
    console.error("[API stock-movements] Unexpected list error:", err)
    return NextResponse.json({ error: "Erro interno ao carregar auditoria de estoque." }, { status: 500 })
  }
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

    const { data, error } = await supabaseAdmin.rpc("safeepi_record_stock_movement", {
      p_company_id: requestedCompanyId,
      p_ppe_id: ppeId,
      p_quantity: quantity,
      p_type: type,
      p_motive: motive,
      p_delivery_id: typeof body.delivery_id === "string" && body.delivery_id ? body.delivery_id : null,
      p_created_by_id: auth.user.id,
      p_created_by_name: auth.user.email || "Usuario SafeEPI",
    })

    if (error) {
      const status = error.message.includes("insufficient_stock") ? 409 : error.message.includes("not_found") ? 404 : 500
      console.error("[API stock-movements] Atomic movement error:", error)
      return NextResponse.json({
        error: status === 409 ? "Estoque insuficiente para esta movimentacao." :
          status === 404 ? "EPI/CA nao encontrado para a empresa atual." : "Erro interno, tente novamente",
      }, { status })
    }

    return NextResponse.json({ data })
  } catch (err) {
    console.error("[API stock-movements] Unexpected error:", err)
    return NextResponse.json({ error: "Erro interno ao movimentar estoque." }, { status: 500 })
  }
}
