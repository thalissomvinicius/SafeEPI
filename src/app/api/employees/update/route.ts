import { NextRequest, NextResponse } from "next/server"
import crypto from "crypto"
import { requireAuthorizedUser } from "@/lib/serverAuth"
import { supabaseAdmin } from "@/lib/supabaseAdmin"

const EMPLOYEE_ARCHIVE_MARKER = "employee_soft_delete"

type SupabaseLikeError = {
  code?: string
  details?: string | null
  hint?: string | null
  message?: string
}

function resolveCompanyId(authUser: { role: string; company_id: string | null }, requestedCompanyId: unknown) {
  if (authUser.role === "MASTER") return typeof requestedCompanyId === "string" && requestedCompanyId ? requestedCompanyId : null
  return authUser.company_id
}

function isMissingSoftDeleteColumn(error: unknown) {
  if (!error || typeof error !== "object") return false
  const maybeError = error as SupabaseLikeError
  const text = `${maybeError.message || ""} ${maybeError.details || ""} ${maybeError.hint || ""}`.toLowerCase()

  return (
    maybeError.code === "PGRST204" ||
    maybeError.code === "42703" ||
    text.includes("schema cache") ||
    text.includes("could not find") ||
    text.includes("column")
  ) && text.includes("deleted_at")
}

function getLongArchiveExpiry() {
  const expiresAt = new Date()
  expiresAt.setFullYear(expiresAt.getFullYear() + 100)
  return expiresAt.toISOString()
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
      .select("id, full_name, active, termination_date")
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

    const today = new Date().toISOString().slice(0, 10)
    const updates = {
      active: false,
      deleted_at: new Date().toISOString(),
      deleted_by: auth.user.id,
      ...(!employee.termination_date ? { termination_date: today } : {}),
    }

    const { data, error } = await supabaseAdmin
      .from("employees")
      .update(updates)
      .eq("id", id)
      .eq("company_id", companyId)
      .select("id, full_name, deleted_at")

    if (error) {
      if (isMissingSoftDeleteColumn(error)) {
        const archivedAt = new Date().toISOString()
        const token = crypto.randomBytes(32).toString("hex")

        const { error: fallbackUpdateError } = await supabaseAdmin
          .from("employees")
          .update({
            active: false,
            ...(!employee.termination_date ? { termination_date: today } : {}),
          })
          .eq("id", id)
          .eq("company_id", companyId)

        if (fallbackUpdateError) {
          console.error("[API employees/update] Fallback archive update error:", fallbackUpdateError)
          return NextResponse.json({ error: fallbackUpdateError.message }, { status: 500 })
        }

        const { error: markerError } = await supabaseAdmin
          .from("remote_links")
          .insert({
            employee_id: id,
            company_id: companyId,
            type: "capture",
            token,
            status: "completed",
            data: {
              safeepi_purpose: EMPLOYEE_ARCHIVE_MARKER,
              archived_at: archivedAt,
              archived_by: auth.user.id,
              employee_name: employee.full_name,
            },
            expires_at: getLongArchiveExpiry(),
            completed_at: archivedAt,
          })

        if (markerError) {
          console.error("[API employees/update] Fallback archive marker error:", markerError)
          return NextResponse.json(
            {
              error: "Colaborador foi inativado, mas o sistema nao conseguiu criar o marcador de exclusao. Rode o script add_employee_soft_delete.sql no Supabase para concluir este recurso.",
            },
            { status: 500 },
          )
        }

        return NextResponse.json({
          employee: {
            id: employee.id,
            full_name: employee.full_name,
            archived_at: archivedAt,
          },
          warning: "Banco sem coluna deleted_at; arquivamento preservado por marcador interno.",
        })
      }

      console.error("[API employees/update] Soft delete error:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ employee: data?.[0] || employee })
  } catch (err) {
    console.error("[API employees/update] Unexpected delete error:", err)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}
