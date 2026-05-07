import { NextRequest, NextResponse } from "next/server"
import { requireAuthorizedUser } from "@/lib/serverAuth"
import { supabaseAdmin } from "@/lib/supabaseAdmin"

function resolveCompanyId(authUser: { role: string; company_id: string | null }, requestedCompanyId: unknown) {
  if (authUser.role === "MASTER") return typeof requestedCompanyId === "string" && requestedCompanyId ? requestedCompanyId : null
  return authUser.company_id
}

export async function POST(request: NextRequest) {
  const auth = await requireAuthorizedUser(request, ["MASTER", "ADMIN"])
  if (!auth.authorized) {
    return auth.response
  }

  try {
    const body = await request.json()
    const { employee, company_id } = body
    const companyId = resolveCompanyId(auth.user, company_id)

    if (!companyId) {
      return NextResponse.json({ error: "Empresa atual nao encontrada para este usuario." }, { status: 400 })
    }

    if (!employee || typeof employee !== "object") {
      return NextResponse.json({ error: "Dados do colaborador sao obrigatorios." }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin
      .from("employees")
      .insert([{ ...employee, company_id: companyId }])
      .select()

    if (error) {
      console.error("[API employees/update] Insert error:", error)
      return NextResponse.json({ error: error.message, code: error.code, details: error.details }, { status: 500 })
    }

    return NextResponse.json({ employee: data?.[0] || null })
  } catch (err) {
    console.error("[API employees/update] Unexpected insert error:", err)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireAuthorizedUser(request, ["MASTER", "ADMIN"])
  if (!auth.authorized) {
    return auth.response
  }

  try {
    const body = await request.json()
    const { id, updates, removePhoto, company_id } = body
    const companyId = resolveCompanyId(auth.user, company_id)

    if (!id) {
      return NextResponse.json({ error: "ID do colaborador é obrigatório" }, { status: 400 })
    }

    if (!companyId) {
      return NextResponse.json({ error: "Empresa atual nao encontrada para este usuario." }, { status: 400 })
    }

    if (removePhoto) {
      const { data, error } = await supabaseAdmin
        .from("employees")
        .update({ photo_url: null, face_descriptor: null })
        .eq("id", id)
        .eq("company_id", companyId)
        .select()

      if (error) {
        console.error("[API employees/update] Remove photo error:", error)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      console.log("[API employees/update] Photo removed. Result:", data)
      return NextResponse.json({ employee: data?.[0] || null })
    }

    if (updates && Object.keys(updates).length > 0) {
      const { data, error } = await supabaseAdmin
        .from("employees")
        .update(updates)
        .eq("id", id)
        .eq("company_id", companyId)
        .select()

      if (error) {
        console.error("[API employees/update] Update error:", error)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      console.log("[API employees/update] Updated. Result count:", data?.length)
      return NextResponse.json({ employee: data?.[0] || null })
    }

    return NextResponse.json({ error: "Nenhuma atualização fornecida" }, { status: 400 })
  } catch (err) {
    console.error("[API employees/update] Unexpected error:", err)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}
