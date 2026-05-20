import { NextResponse } from "next/server"
import { requireAuthorizedUser } from "@/lib/serverAuth"
import { supabaseAdmin } from "@/lib/supabaseAdmin"
import { normalizeStoragePath, signStorageValue } from "@/lib/privateStorage"

type CompanyPayload = {
  id?: string
  name?: string
  trade_name?: string | null
  cnpj?: string | null
  email?: string | null
  phone?: string | null
  address?: string | null
  logo_url?: string | null
  primary_color?: string | null
  active?: boolean
  training_enabled?: boolean
  third_parties_enabled?: boolean
  subscription_status?: "ACTIVE" | "PAST_DUE" | "SUSPENDED"
  suspended_reason?: string | null
}

const countTables = [
  ["employees", "employees_count"],
  ["ppes", "ppes_count"],
  ["deliveries", "deliveries_count"],
  ["company_users", "users_count"],
] as const

async function getCompanyCounts(companyId: string) {
  const entries = await Promise.all(
    countTables.map(async ([table, key]) => {
      const { count } = await supabaseAdmin
        .from(table)
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId)

      return [key, count || 0] as const
    })
  )

  return Object.fromEntries(entries)
}

async function withSignedCompanyLogo<T extends { logo_url?: string | null }>(company: T) {
  return {
    ...company,
    logo_storage_path: company.logo_url || null,
    logo_url: await signStorageValue(company.logo_url),
  }
}

function sanitizeCompanyPayload(payload: CompanyPayload) {
  return {
    name: payload.name?.trim(),
    trade_name: payload.trade_name?.trim() || null,
    cnpj: payload.cnpj?.trim() || null,
    email: payload.email?.trim() || null,
    phone: payload.phone?.trim() || null,
    address: payload.address?.trim() || null,
    logo_url: normalizeStoragePath(payload.logo_url) || payload.logo_url?.trim() || null,
    primary_color: payload.primary_color || "#2563EB",
    active: payload.active ?? true,
    training_enabled: payload.training_enabled ?? false,
    third_parties_enabled: payload.third_parties_enabled ?? false,
    subscription_status: payload.subscription_status || (payload.active === false ? "SUSPENDED" : "ACTIVE"),
    suspended_reason: payload.suspended_reason?.trim() || null,
  }
}

function isMissingCommercialColumns(error: { message?: string; details?: string | null; code?: string } | null) {
  const text = `${error?.message || ""} ${error?.details || ""}`.toLowerCase()
  return (
    error?.code === "PGRST204" ||
    text.includes("schema cache") ||
    text.includes("subscription_status") ||
    text.includes("training_enabled") ||
    text.includes("third_parties_enabled") ||
    text.includes("suspended_reason")
  )
}

function withoutCommercialColumns(payload: ReturnType<typeof sanitizeCompanyPayload>) {
  const basicPayload: Partial<ReturnType<typeof sanitizeCompanyPayload>> = { ...payload }
  delete basicPayload.training_enabled
  delete basicPayload.third_parties_enabled
  delete basicPayload.subscription_status
  delete basicPayload.suspended_reason
  return basicPayload
}

export async function GET(request: Request) {
  const auth = await requireAuthorizedUser(request, ["MASTER"])
  if (!auth.authorized) return auth.response

  try {
    const { data, error } = await supabaseAdmin
      .from("companies")
      .select("*")
      .order("created_at", { ascending: false })

    if (error) {
      console.error("[companies][GET] list error:", error)
      return NextResponse.json({ error: "Operacao nao permitida" }, { status: 400 })
    }

    const companies = await Promise.all(
      (data || []).map(async (company) => withSignedCompanyLogo({
        ...company,
        ...(await getCompanyCounts(company.id)),
      }))
    )

    return NextResponse.json({ companies })
  } catch (err: unknown) {
    console.error("[companies][GET] unexpected error:", err)
    return NextResponse.json({ error: "Erro interno, tente novamente" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const auth = await requireAuthorizedUser(request, ["MASTER"])
  if (!auth.authorized) return auth.response

  try {
    const payload = sanitizeCompanyPayload(await request.json())

    if (!payload.name) {
      return NextResponse.json({ error: "Nome da empresa e obrigatorio." }, { status: 400 })
    }

    let result = await supabaseAdmin
      .from("companies")
      .insert(payload)
      .select("*")
      .single()

    if (result.error && isMissingCommercialColumns(result.error)) {
      result = await supabaseAdmin
        .from("companies")
        .insert(withoutCommercialColumns(payload))
        .select("*")
        .single()
    }

    if (result.error) {
      console.error("[companies][POST] insert error:", result.error)
      return NextResponse.json({ error: "Operacao nao permitida" }, { status: 400 })
    }

    return NextResponse.json({ company: await withSignedCompanyLogo(result.data) })
  } catch (err: unknown) {
    console.error("[companies][POST] unexpected error:", err)
    return NextResponse.json({ error: "Erro interno, tente novamente" }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  const auth = await requireAuthorizedUser(request, ["MASTER"])
  if (!auth.authorized) return auth.response

  try {
    const body = await request.json() as CompanyPayload

    if (!body.id) {
      return NextResponse.json({ error: "Empresa nao informada." }, { status: 400 })
    }

    const payload = sanitizeCompanyPayload(body)
    if (!payload.name) {
      return NextResponse.json({ error: "Nome da empresa e obrigatorio." }, { status: 400 })
    }

    let result = await supabaseAdmin
      .from("companies")
      .update(payload)
      .eq("id", body.id)
      .select("*")
      .single()

    if (result.error && isMissingCommercialColumns(result.error)) {
      result = await supabaseAdmin
        .from("companies")
        .update(withoutCommercialColumns(payload))
        .eq("id", body.id)
        .select("*")
        .single()
    }

    if (result.error) {
      console.error("[companies][PUT] update error:", result.error)
      return NextResponse.json({ error: "Operacao nao permitida" }, { status: 400 })
    }

    return NextResponse.json({ company: await withSignedCompanyLogo(result.data) })
  } catch (err: unknown) {
    console.error("[companies][PUT] unexpected error:", err)
    return NextResponse.json({ error: "Erro interno, tente novamente" }, { status: 500 })
  }
}
