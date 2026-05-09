import { NextRequest, NextResponse } from "next/server"
import { requireAuthorizedUser } from "@/lib/serverAuth"
import { supabaseAdmin } from "@/lib/supabaseAdmin"

function resolveCompanyId(authUser: { role: string; company_id: string | null }, requestedCompanyId: unknown) {
  if (authUser.role === "MASTER") return typeof requestedCompanyId === "string" && requestedCompanyId ? requestedCompanyId : null
  return authUser.company_id
}

async function countEmployeeLinks(tableName: "deliveries" | "trainings" | "signed_documents", employeeId: string, companyId: string) {
  const { count, error } = await supabaseAdmin
    .from(tableName)
    .select("id", { count: "exact", head: true })
    .eq("employee_id", employeeId)
    .eq("company_id", companyId)

  if (error) {
    console.error(`[API employees/update] Link count error on ${tableName}:`, error)
    throw error
  }

  return count || 0
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

export async function DELETE(request: NextRequest) {
  const auth = await requireAuthorizedUser(request, ["MASTER", "ADMIN"])
  if (!auth.authorized) {
    return auth.response
  }

  try {
    const body = await request.json()
    const { id, company_id } = body
    const companyId = resolveCompanyId(auth.user, company_id)

    if (!id || typeof id !== "string") {
      return NextResponse.json({ error: "ID do colaborador e obrigatorio." }, { status: 400 })
    }

    if (!companyId) {
      return NextResponse.json({ error: "Empresa atual nao encontrada para este usuario." }, { status: 400 })
    }

    const { data: employee, error: employeeError } = await supabaseAdmin
      .from("employees")
      .select("id, full_name")
      .eq("id", id)
      .eq("company_id", companyId)
      .maybeSingle()

    if (employeeError) {
      console.error("[API employees/update] Find employee before delete error:", employeeError)
      return NextResponse.json({ error: employeeError.message }, { status: 500 })
    }

    if (!employee) {
      return NextResponse.json({ error: "Colaborador nao encontrado nesta empresa." }, { status: 404 })
    }

    const [deliveriesCount, trainingsCount, signedDocumentsCount] = await Promise.all([
      countEmployeeLinks("deliveries", id, companyId),
      countEmployeeLinks("trainings", id, companyId),
      countEmployeeLinks("signed_documents", id, companyId),
    ])

    const linkedRecords = deliveriesCount + trainingsCount + signedDocumentsCount
    if (linkedRecords > 0) {
      return NextResponse.json(
        {
          error: "Este colaborador possui historico, treinamentos ou documentos assinados. Use Desligar para preservar a auditoria.",
          linkedRecords,
        },
        { status: 409 },
      )
    }

    const { data, error } = await supabaseAdmin
      .from("employees")
      .delete()
      .eq("id", id)
      .eq("company_id", companyId)
      .select("id, full_name")

    if (error) {
      console.error("[API employees/update] Delete error:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ employee: data?.[0] || employee })
  } catch (err) {
    console.error("[API employees/update] Unexpected delete error:", err)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}
