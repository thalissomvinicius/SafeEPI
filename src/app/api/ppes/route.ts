import { NextRequest, NextResponse } from "next/server"
import { requireAuthorizedUser } from "@/lib/serverAuth"
import { supabaseAdmin } from "@/lib/supabaseAdmin"

function resolveCompanyId(authUser: { role: string; company_id: string | null }, requestedCompanyId: unknown) {
  if (authUser.role === "MASTER") return typeof requestedCompanyId === "string" && requestedCompanyId ? requestedCompanyId : null
  return authUser.company_id
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAuthorizedUser(request, ["MASTER"])
  if (!auth.authorized) {
    return auth.response
  }

  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get("id")
    const companyId = resolveCompanyId(auth.user, searchParams.get("company_id"))

    if (!id) {
      return NextResponse.json({ error: "ID do EPI/CA e obrigatorio." }, { status: 400 })
    }

    if (!companyId) {
      return NextResponse.json({ error: "Empresa atual nao encontrada para este usuario." }, { status: 400 })
    }

    const { error } = await supabaseAdmin
      .from("ppes")
      .update({ active: false })
      .eq("id", id)
      .eq("company_id", companyId)

    if (error) {
      console.error("[API ppes] Delete error:", error)
      return NextResponse.json({ error: "Erro interno, tente novamente" }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[API ppes] Unexpected delete error:", err)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireAuthorizedUser(request, ["MASTER", "ADMIN", "ALMOXARIFE", "DIRETORIA"])
  if (!auth.authorized) {
    return auth.response
  }

  try {
    const body = await request.json()
    const id = typeof body.id === "string" ? body.id : ""
    const companyId = resolveCompanyId(auth.user, body.company_id)
    const rawUpdates = body.updates && typeof body.updates === "object" ? body.updates : {}

    if (!id) {
      return NextResponse.json({ error: "ID do EPI/CA e obrigatorio." }, { status: 400 })
    }

    if (!companyId) {
      return NextResponse.json({ error: "Empresa atual nao encontrada para este usuario." }, { status: 400 })
    }

    const allowedFields = [
      "name",
      "manufacturer",
      "ca_number",
      "ca_expiry_date",
      "lifespan_days",
      "cost",
      "active",
      "current_stock",
    ]
    const updates = Object.fromEntries(
      Object.entries(rawUpdates).filter(([key]) => allowedFields.includes(key)),
    )

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "Nenhum campo valido para atualizar." }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin
      .from("ppes")
      .update(updates)
      .eq("id", id)
      .eq("company_id", companyId)
      .select()
      .maybeSingle()

    if (error) {
      console.error("[API ppes] Update error:", error)
      return NextResponse.json({ error: "Erro interno, tente novamente" }, { status: 500 })
    }

    if (!data) {
      return NextResponse.json({ error: "EPI/CA nao encontrado para a empresa atual." }, { status: 404 })
    }

    return NextResponse.json({ ppe: data })
  } catch (err) {
    console.error("[API ppes] Unexpected update error:", err)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}
