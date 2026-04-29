import { NextRequest, NextResponse } from "next/server"
import { requireAuthorizedUser } from "@/lib/serverAuth"
import { supabaseAdmin } from "@/lib/supabaseAdmin"

export async function PUT(request: NextRequest) {
  const auth = await requireAuthorizedUser(request, ["ADMIN"])
  if (!auth.authorized) {
    return auth.response
  }

  try {
    const body = await request.json()
    const { id, updates, removePhoto } = body

    if (!id) {
      return NextResponse.json({ error: "ID do colaborador é obrigatório" }, { status: 400 })
    }

    if (!auth.user.companyId) {
      return NextResponse.json({ error: "Empresa ativa nao encontrada para esta sessao." }, { status: 403 })
    }

    if (removePhoto) {
      const { data, error } = await supabaseAdmin
        .from("employees")
        .update({ photo_url: null, face_descriptor: null })
        .eq("id", id)
        .eq("company_id", auth.user.companyId)
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
        .eq("company_id", auth.user.companyId)
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
