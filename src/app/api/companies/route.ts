import { NextResponse } from "next/server"
import { requireAuthorizedUser } from "@/lib/serverAuth"
import { supabaseAdmin } from "@/lib/supabaseAdmin"

type CompanyPayload = {
  id?: string
  name?: string
  trade_name?: string | null
  cnpj?: string | null
  email?: string | null
  phone?: string | null
  address?: string | null
  primary_color?: string | null
  active?: boolean
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

function sanitizeCompanyPayload(payload: CompanyPayload) {
  return {
    name: payload.name?.trim(),
    trade_name: payload.trade_name?.trim() || null,
    cnpj: payload.cnpj?.trim() || null,
    email: payload.email?.trim() || null,
    phone: payload.phone?.trim() || null,
    address: payload.address?.trim() || null,
    primary_color: payload.primary_color || "#2563EB",
    active: payload.active ?? true,
  }
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
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    const companies = await Promise.all(
      (data || []).map(async (company) => ({
        ...company,
        ...(await getCompanyCounts(company.id)),
      }))
    )

    return NextResponse.json({ companies })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Erro interno do servidor"
    return NextResponse.json({ error: message }, { status: 500 })
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

    const { data, error } = await supabaseAdmin
      .from("companies")
      .insert(payload)
      .select("*")
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ company: data })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Erro interno do servidor"
    return NextResponse.json({ error: message }, { status: 500 })
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

    const { data, error } = await supabaseAdmin
      .from("companies")
      .update(payload)
      .eq("id", body.id)
      .select("*")
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ company: data })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Erro interno do servidor"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
