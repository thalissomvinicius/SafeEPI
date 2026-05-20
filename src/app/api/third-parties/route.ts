import { NextRequest, NextResponse } from "next/server"
import { requireAuthorizedUser } from "@/lib/serverAuth"
import { supabaseAdmin } from "@/lib/supabaseAdmin"

function resolveCompanyId(authUser: { role: string; company_id: string | null }, requestedCompanyId: unknown) {
  if (authUser.role === "MASTER") return typeof requestedCompanyId === "string" && requestedCompanyId ? requestedCompanyId : null
  return authUser.company_id
}

function pickThirdPartyPayload(raw: unknown) {
  const source = raw && typeof raw === "object" ? raw as Record<string, unknown> : {}
  const allowedFields = [
    "name",
    "trade_name",
    "cnpj",
    "contact_name",
    "phone",
    "email",
    "address",
    "notes",
    "active",
  ]

  return Object.fromEntries(
    Object.entries(source).filter(([key]) => allowedFields.includes(key)),
  )
}

export async function POST(request: NextRequest) {
  const auth = await requireAuthorizedUser(request, ["MASTER", "ADMIN", "ALMOXARIFE", "DIRETORIA"])
  if (!auth.authorized) return auth.response

  try {
    const body = await request.json()
    const companyId = resolveCompanyId(auth.user, body.company_id)

    if (!companyId) {
      return NextResponse.json({ error: "Empresa atual nao encontrada para este usuario." }, { status: 400 })
    }

    const payload: Record<string, unknown> = {
      ...pickThirdPartyPayload(body.thirdParty || body),
      company_id: companyId,
    }

    if (typeof payload.name !== "string" || !payload.name.trim()) {
      return NextResponse.json({ error: "Razao social do terceiro e obrigatoria." }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin
      .from("third_parties")
      .insert([payload])
      .select()
      .maybeSingle()

    if (error) {
      console.error("[API third-parties] Create error:", error)
      return NextResponse.json({ error: "Erro interno, tente novamente" }, { status: 500 })
    }

    return NextResponse.json({ thirdParty: data })
  } catch (err) {
    console.error("[API third-parties] Unexpected create error:", err)
    return NextResponse.json({ error: "Erro interno ao cadastrar terceiro." }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireAuthorizedUser(request, ["MASTER", "ADMIN", "ALMOXARIFE", "DIRETORIA"])
  if (!auth.authorized) return auth.response

  try {
    const body = await request.json()
    const id = typeof body.id === "string" ? body.id : ""
    const companyId = resolveCompanyId(auth.user, body.company_id)

    if (!id) {
      return NextResponse.json({ error: "ID do terceiro e obrigatorio." }, { status: 400 })
    }

    if (!companyId) {
      return NextResponse.json({ error: "Empresa atual nao encontrada para este usuario." }, { status: 400 })
    }

    const updates = pickThirdPartyPayload(body.updates || body.thirdParty || {})

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "Nenhum campo valido para atualizar." }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin
      .from("third_parties")
      .update(updates)
      .eq("id", id)
      .eq("company_id", companyId)
      .select()
      .maybeSingle()

    if (error) {
      console.error("[API third-parties] Update error:", error)
      return NextResponse.json({ error: "Erro interno, tente novamente" }, { status: 500 })
    }

    if (!data) {
      return NextResponse.json({ error: "Terceiro nao encontrado para a empresa atual." }, { status: 404 })
    }

    return NextResponse.json({ thirdParty: data })
  } catch (err) {
    console.error("[API third-parties] Unexpected update error:", err)
    return NextResponse.json({ error: "Erro interno ao atualizar terceiro." }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAuthorizedUser(request, ["MASTER", "ADMIN", "ALMOXARIFE", "DIRETORIA"])
  if (!auth.authorized) return auth.response

  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get("id")
    const companyId = resolveCompanyId(auth.user, searchParams.get("company_id"))

    if (!id) {
      return NextResponse.json({ error: "ID do terceiro e obrigatorio." }, { status: 400 })
    }

    if (!companyId) {
      return NextResponse.json({ error: "Empresa atual nao encontrada para este usuario." }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin
      .from("third_parties")
      .update({ active: false })
      .eq("id", id)
      .eq("company_id", companyId)
      .select("id")
      .maybeSingle()

    if (error) {
      console.error("[API third-parties] Delete error:", error)
      return NextResponse.json({ error: "Erro interno, tente novamente" }, { status: 500 })
    }

    if (!data) {
      return NextResponse.json({ error: "Terceiro nao encontrado para a empresa atual." }, { status: 404 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[API third-parties] Unexpected delete error:", err)
    return NextResponse.json({ error: "Erro interno ao remover terceiro." }, { status: 500 })
  }
}
