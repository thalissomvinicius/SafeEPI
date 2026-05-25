import { NextRequest, NextResponse } from "next/server"
import crypto from "crypto"
import { requireAuthorizedUser } from "@/lib/serverAuth"
import { supabaseAdmin } from "@/lib/supabaseAdmin"

const EMPLOYEE_ARCHIVE_MARKER = "employee_soft_delete"
const EMPLOYEE_PUBLIC_SELECT = [
  "id",
  "company_id",
  "third_party_id",
  "full_name",
  "cpf",
  "job_title",
  "department",
  "admission_date",
  "active",
  "workplace_id",
  "termination_date",
  "photo_url",
  "created_at",
].join(",")

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

function isMissingThirdPartyColumn(error: unknown) {
  if (!error || typeof error !== "object") return false
  const maybeError = error as SupabaseLikeError
  const text = `${maybeError.message || ""} ${maybeError.details || ""} ${maybeError.hint || ""}`.toLowerCase()

  return (
    maybeError.code === "PGRST204" ||
    maybeError.code === "42703" ||
    text.includes("schema cache") ||
    text.includes("could not find") ||
    text.includes("column")
  ) && text.includes("third_party_id")
}

function isForeignKeyIssue(error: unknown) {
  if (!error || typeof error !== "object") return false
  return (error as SupabaseLikeError).code === "23503"
}

function isUniqueIssue(error: unknown) {
  if (!error || typeof error !== "object") return false
  const maybeError = error as SupabaseLikeError
  const text = `${maybeError.message || ""} ${maybeError.details || ""} ${maybeError.hint || ""}`.toLowerCase()
  return maybeError.code === "23505" || (text.includes("duplicate key") && text.includes("cpf"))
}

function cleanEmployeePayload(payload: unknown) {
  if (!payload || typeof payload !== "object") return {}
  return Object.fromEntries(
    Object.entries(payload as Record<string, unknown>).filter(([, value]) => value !== undefined)
  )
}

async function validateThirdPartyAccess(thirdPartyId: unknown, companyId: string) {
  if (!thirdPartyId || typeof thirdPartyId !== "string") return { ok: true as const }

  const { data, error } = await supabaseAdmin
    .from("third_parties")
    .select("id")
    .eq("id", thirdPartyId)
    .eq("company_id", companyId)
    .maybeSingle()

  if (error) {
    console.error("[API employees/update] Third-party validation error:", error)
    return { ok: false as const, response: NextResponse.json({ error: "Erro ao validar terceiro selecionado." }, { status: 500 }) }
  }

  if (!data) {
    return { ok: false as const, response: NextResponse.json({ error: "Terceiro selecionado nao pertence a empresa atual." }, { status: 400 }) }
  }

  return { ok: true as const }
}

function employeeSchemaErrorResponse(error: unknown) {
  if (isMissingThirdPartyColumn(error)) {
    return NextResponse.json({
      error: "O banco ainda nao tem a coluna employees.third_party_id. Rode a migration database/migrations/safeepi_third_parties.sql no Supabase para vincular colaboradores a terceiros.",
      code: "EMPLOYEES_THIRD_PARTY_COLUMN_MISSING",
    }, { status: 501 })
  }

  if (isForeignKeyIssue(error)) {
    return NextResponse.json({
      error: "Terceiro invalido para este colaborador. Recarregue a pagina e selecione um terceiro ativo da empresa atual.",
      code: "EMPLOYEE_THIRD_PARTY_INVALID",
    }, { status: 400 })
  }

  return null
}

function getLongArchiveExpiry() {
  const expiresAt = new Date()
  expiresAt.setFullYear(expiresAt.getFullYear() + 100)
  return expiresAt.toISOString()
}

async function findExistingEmployeeByCpf(companyId: string, cpf: unknown) {
  if (!cpf || typeof cpf !== "string") return { data: null, error: null }

  const baseQuery = supabaseAdmin
    .from("employees")
    .select("id, full_name, active, termination_date, deleted_at")
    .eq("company_id", companyId)
    .eq("cpf", cpf)
    .maybeSingle()

  const result = await baseQuery
  if (!isMissingSoftDeleteColumn(result.error)) return result

  return supabaseAdmin
    .from("employees")
    .select("id, full_name, active, termination_date")
    .eq("company_id", companyId)
    .eq("cpf", cpf)
    .maybeSingle()
}

async function reviveEmployeeFromPayload(id: string, companyId: string, employeePayload: Record<string, unknown>) {
  const revivePayload = {
    ...employeePayload,
    active: employeePayload.active !== false,
    termination_date: employeePayload.termination_date || null,
    deleted_at: null,
    deleted_by: null,
  }

  let result = await supabaseAdmin
    .from("employees")
    .update(revivePayload)
    .eq("id", id)
    .eq("company_id", companyId)
    .select(EMPLOYEE_PUBLIC_SELECT)

  if (isMissingSoftDeleteColumn(result.error)) {
    const fallbackPayload: Record<string, unknown> = { ...revivePayload }
    delete fallbackPayload.deleted_at
    delete fallbackPayload.deleted_by
    result = await supabaseAdmin
      .from("employees")
      .update(fallbackPayload)
      .eq("id", id)
      .eq("company_id", companyId)
      .select(EMPLOYEE_PUBLIC_SELECT)
  }

  return result
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

    const employeePayload = cleanEmployeePayload(employee)
    const thirdPartyValidation = await validateThirdPartyAccess(employeePayload.third_party_id, companyId)
    if (!thirdPartyValidation.ok) return thirdPartyValidation.response

    const existingEmployeeResult = await findExistingEmployeeByCpf(companyId, employeePayload.cpf)
    if (existingEmployeeResult.error) {
      console.error("[API employees/update] Existing CPF lookup error:", existingEmployeeResult.error)
      return NextResponse.json({ error: "Erro ao validar CPF do colaborador." }, { status: 500 })
    }

    if (existingEmployeeResult.data) {
      const existingEmployee = existingEmployeeResult.data as {
        id: string
        active?: boolean | null
        deleted_at?: string | null
      }

      if (existingEmployee.active && !existingEmployee.deleted_at) {
        return NextResponse.json({
          error: "Este CPF ja esta cadastrado em um colaborador ativo. Abra o cadastro existente para editar.",
          code: "23505",
        }, { status: 409 })
      }

      const reviveResult = await reviveEmployeeFromPayload(existingEmployee.id, companyId, employeePayload)
      if (reviveResult.error) {
        const schemaResponse = employeeSchemaErrorResponse(reviveResult.error)
        if (schemaResponse) return schemaResponse
        console.error("[API employees/update] Revive archived employee error:", reviveResult.error)
        return NextResponse.json({ error: "Erro interno, tente novamente" }, { status: 500 })
      }

      return NextResponse.json({
        employee: reviveResult.data?.[0] || null,
        restored: true,
      })
    }

    const { data, error } = await supabaseAdmin
      .from("employees")
      .insert([{ ...employeePayload, company_id: companyId }])
      .select(EMPLOYEE_PUBLIC_SELECT)

    if (error) {
      const schemaResponse = employeeSchemaErrorResponse(error)
      if (schemaResponse) return schemaResponse
      if (isUniqueIssue(error)) {
        return NextResponse.json({
          error: "Este CPF ja esta cadastrado. Abra o cadastro existente para editar os dados do colaborador.",
          code: "23505",
        }, { status: 409 })
      }
      console.error("[API employees/update] Insert error:", error)
      return NextResponse.json({ error: "Erro interno, tente novamente" }, { status: 500 })
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
        .select(EMPLOYEE_PUBLIC_SELECT)

      if (error) {
        console.error("[API employees/update] Remove photo error:", error)
        return NextResponse.json({ error: "Erro interno, tente novamente" }, { status: 500 })
      }

      console.log("[API employees/update] Photo removed. Result:", data)
      return NextResponse.json({ employee: data?.[0] || null })
    }

    if (updates && Object.keys(updates).length > 0) {
      const cleanUpdates = cleanEmployeePayload(updates)
      const thirdPartyValidation = await validateThirdPartyAccess(cleanUpdates.third_party_id, companyId)
      if (!thirdPartyValidation.ok) return thirdPartyValidation.response

      const { data, error } = await supabaseAdmin
        .from("employees")
        .update(cleanUpdates)
        .eq("id", id)
        .eq("company_id", companyId)
        .select(EMPLOYEE_PUBLIC_SELECT)

      if (error) {
        const schemaResponse = employeeSchemaErrorResponse(error)
        if (schemaResponse) return schemaResponse
        console.error("[API employees/update] Update error:", error)
        return NextResponse.json({ error: "Erro interno, tente novamente" }, { status: 500 })
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
      return NextResponse.json({ error: "Erro interno, tente novamente" }, { status: 500 })
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
          return NextResponse.json({ error: "Erro interno, tente novamente" }, { status: 500 })
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
      return NextResponse.json({ error: "Erro interno, tente novamente" }, { status: 500 })
    }

    return NextResponse.json({ employee: data?.[0] || employee })
  } catch (err) {
    console.error("[API employees/update] Unexpected delete error:", err)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}
