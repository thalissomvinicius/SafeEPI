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
      return NextResponse.json({ error: error.message, code: error.code, details: error.details }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[API ppes] Unexpected delete error:", err)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}
