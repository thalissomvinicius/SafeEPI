import { NextResponse } from "next/server"
import { requireAuthorizedUser } from "@/lib/serverAuth"
import { BIOMETRIC_BUCKET, normalizeStoragePath } from "@/lib/privateStorage"
import { supabaseAdmin } from "@/lib/supabaseAdmin"

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type RouteContext = {
  params: Promise<{ id: string }>
}

function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_REGEX.test(value)
}

export async function DELETE(request: Request, context: RouteContext) {
  const auth = await requireAuthorizedUser(request, ["MASTER", "ADMIN"])
  if (!auth.authorized) return auth.response

  const { id } = await Promise.resolve(context.params)
  const { searchParams } = new URL(request.url)
  const reason = searchParams.get("reason") || "manual_deletion"

  if (!isValidUuid(id)) {
    return NextResponse.json({ error: "ID do colaborador invalido." }, { status: 400 })
  }

  try {
    let query = supabaseAdmin
      .from("employees")
      .select("id, company_id, photo_url")
      .eq("id", id)

    if (auth.user.role !== "MASTER") {
      if (!auth.user.company_id) {
        return NextResponse.json({ error: "Empresa atual nao identificada." }, { status: 403 })
      }
      query = query.eq("company_id", auth.user.company_id)
    }

    const { data: employee, error: fetchError } = await query.maybeSingle()

    if (fetchError) {
      console.error("[employee-biometric-delete] lookup error:", fetchError)
      return NextResponse.json({ error: "Falha ao localizar colaborador." }, { status: 500 })
    }

    if (!employee) {
      return NextResponse.json({ error: "Colaborador nao encontrado." }, { status: 404 })
    }

    const storagePath = normalizeStoragePath(employee.photo_url, BIOMETRIC_BUCKET)
    if (storagePath) {
      const { error: removeError } = await supabaseAdmin.storage
        .from(BIOMETRIC_BUCKET)
        .remove([storagePath])

      if (removeError) {
        console.error("[employee-biometric-delete] storage remove error:", removeError)
        return NextResponse.json({ error: "Falha ao remover foto biometrica do storage." }, { status: 500 })
      }
    }

    const { error: updateError } = await supabaseAdmin
      .from("employees")
      .update({ photo_url: null, face_descriptor: null })
      .eq("id", id)

    if (updateError) {
      console.error("[employee-biometric-delete] employee update error:", updateError)
      return NextResponse.json({ error: "Falha ao limpar dados biometricos." }, { status: 500 })
    }

    const { error: logError } = await supabaseAdmin
      .from("biometric_deletion_log")
      .insert({
        employee_id: employee.id,
        company_id: employee.company_id,
        photo_url: employee.photo_url,
        reason,
      })

    if (logError) {
      console.error("[employee-biometric-delete] log insert error:", logError)
      return NextResponse.json({ error: "Biometria removida, mas falhou o registro de auditoria." }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[employee-biometric-delete] unexpected error:", error)
    return NextResponse.json({ error: "Erro interno do servidor." }, { status: 500 })
  }
}
