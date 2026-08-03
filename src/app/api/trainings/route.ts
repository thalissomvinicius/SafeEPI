import { NextRequest, NextResponse } from "next/server"
import { requireAuthorizedUser } from "@/lib/serverAuth"
import { supabaseAdmin } from "@/lib/supabaseAdmin"
import { collectSupabasePages } from "@/lib/supabasePagination"

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

function isMissingColumnIssue(error: unknown, columns: string[]) {
  if (!error || typeof error !== "object") return false
  const maybeError = error as SupabaseLikeError & { status?: number }
  const text = `${maybeError.message || ""} ${maybeError.details || ""} ${maybeError.hint || ""}`.toLowerCase()

  return (
    maybeError.code === "PGRST204" ||
    maybeError.code === "42703" ||
    maybeError.status === 400 ||
    text.includes("schema cache") ||
    text.includes("could not find") ||
    text.includes("column")
  ) && columns.some((column) => text.includes(column.toLowerCase()))
}

function isTrainingSchemaCompatibilityIssue(error: unknown) {
  return isMissingColumnIssue(error, [
    "company_id",
    "instructor_id",
    "instructor_name",
    "instructor_role",
    "signature_url",
    "auth_method",
  ])
}

function getBaseTraining(training: Record<string, unknown>) {
  return {
    employee_id: training.employee_id,
    training_name: training.training_name,
    completion_date: training.completion_date,
    expiry_date: training.expiry_date,
  }
}

function getFullTraining(training: Record<string, unknown>) {
  const payload = { ...training }
  delete payload.status
  return payload
}

type TrainingWithEmployeeCompany = Record<string, unknown> & {
  company_id?: string | null
  employee?: {
    full_name?: string | null
    cpf?: string | null
    company_id?: string | null
  } | null
}

function stripEmployeeCompanyId(training: TrainingWithEmployeeCompany) {
  if (!training.employee) return training
  const employee = {
    full_name: training.employee.full_name,
    cpf: training.employee.cpf,
  }
  return { ...training, employee }
}

function belongsToCompany(training: TrainingWithEmployeeCompany, companyId: string) {
  return training.company_id === companyId || (!training.company_id && training.employee?.company_id === companyId)
}

export async function GET(request: NextRequest) {
  const auth = await requireAuthorizedUser(request, ["MASTER", "ADMIN", "DIRETORIA"])
  if (!auth.authorized) {
    return auth.response
  }

  try {
    const { searchParams } = new URL(request.url)
    const companyId = resolveCompanyId(auth.user, searchParams.get("company_id"))

    const trainings = await collectSupabasePages<TrainingWithEmployeeCompany>(
      async (from, to) => {
        let query = supabaseAdmin
          .from("trainings")
          .select("*, employee:employees!trainings_employee_id_fkey(full_name, cpf, company_id)")
          .order("completion_date", { ascending: false })
          .order("id", { ascending: false })

        if (companyId) {
          query = query.or(`company_id.eq.${companyId},company_id.is.null`)
        }

        const { data, error } = await query.range(from, to)
        return {
          data: (data || []) as TrainingWithEmployeeCompany[],
          error,
        }
      },
      { maxRows: 50_000, resourceName: "treinamentos" },
    )
    const scopedTrainings = companyId
      ? trainings.filter((training) => belongsToCompany(training, companyId))
      : trainings

    return NextResponse.json({ trainings: scopedTrainings.map(stripEmployeeCompanyId) })
  } catch (err) {
    console.error("[API trainings] Unexpected list error:", err)
    return NextResponse.json({ error: "Erro interno ao carregar treinamentos." }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAuthorizedUser(request, ["MASTER", "ADMIN"])
  if (!auth.authorized) {
    return auth.response
  }

  try {
    const body = await request.json()
    const { training, company_id } = body
    const companyId = resolveCompanyId(auth.user, company_id)

    if (!training || typeof training !== "object") {
      return NextResponse.json({ error: "Dados do treinamento sao obrigatorios." }, { status: 400 })
    }

    if (!companyId) {
      return NextResponse.json({ error: "Empresa atual nao encontrada para este usuario." }, { status: 400 })
    }

    const fullPayload = { ...getFullTraining(training), company_id: companyId }
    const fullResult = await supabaseAdmin
      .from("trainings")
      .insert([fullPayload])
      .select()

    if (!fullResult.error) {
      return NextResponse.json({ training: fullResult.data?.[0] || null })
    }

    if (!isTrainingSchemaCompatibilityIssue(fullResult.error)) {
      console.error("[API trainings] Insert error:", fullResult.error)
      return NextResponse.json({ error: "Erro interno, tente novamente" }, { status: 500 })
    }

    const fallbackResult = await supabaseAdmin
      .from("trainings")
      .insert([{ ...getBaseTraining(training), company_id: companyId }])
      .select()

    if (!fallbackResult.error) {
      return NextResponse.json({
        training: fallbackResult.data?.[0] || null,
        warning:
          "Treinamento salvo sem dados de instrutor/assinatura. Rode add_training_instructor.sql no Supabase para habilitar certificado completo.",
      })
    }

    if (isMissingColumnIssue(fallbackResult.error, ["company_id"])) {
      const legacyResult = await supabaseAdmin
        .from("trainings")
        .insert([getBaseTraining(training)])
        .select()

      if (!legacyResult.error) {
        return NextResponse.json({
          training: legacyResult.data?.[0] || null,
          warning:
            "Treinamento salvo no formato legado, sem empresa/instrutor/assinatura. Rode safeepi_multi_company.sql e add_training_instructor.sql no Supabase, depois recarregue o schema do PostgREST.",
        })
      }

      console.error("[API trainings] Legacy insert error:", legacyResult.error)
      return NextResponse.json({ error: "Erro interno, tente novamente" }, { status: 500 })
    }

    console.error("[API trainings] Fallback insert error:", fallbackResult.error)
    return NextResponse.json({ error: "Erro interno, tente novamente" }, { status: 500 })
  } catch (err) {
    console.error("[API trainings] Unexpected error:", err)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
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
      return NextResponse.json({ error: "ID do treinamento e obrigatorio." }, { status: 400 })
    }

    if (!companyId) {
      return NextResponse.json({ error: "Empresa atual nao encontrada para este usuario." }, { status: 400 })
    }

    const { error } = await supabaseAdmin
      .from("trainings")
      .delete()
      .eq("id", id)
      .eq("company_id", companyId)

    if (error) {
      console.error("[API trainings] Delete error:", error)
      return NextResponse.json({ error: "Erro interno, tente novamente" }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[API trainings] Unexpected delete error:", err)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}
