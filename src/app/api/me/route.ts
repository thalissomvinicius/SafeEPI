import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabaseAdmin"
import type { Profile } from "@/types/database"

type AppRole = Profile["role"]

const VALID_ROLES = new Set<AppRole>(["ADMIN", "ALMOXARIFE", "DIRETORIA"])
const ADMIN_BYPASS_EMAILS = new Set([
  "thalissomvinicius7@gmail.com",
  "thalissom.cruz@VALLE.br",
])

function normalizeRole(role: unknown): AppRole {
  return VALID_ROLES.has(role as AppRole) ? role as AppRole : "ALMOXARIFE"
}

function companyNameFromEmail(email: string | null | undefined) {
  const domain = email?.split("@")[1]?.split(".")[0]
  if (!domain) return "Minha empresa"
  return domain.charAt(0).toUpperCase() + domain.slice(1)
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null

  if (!token) {
    return NextResponse.json({ error: "Sessao nao informada." }, { status: 401 })
  }

  const {
    data: { user },
    error,
  } = await supabaseAdmin.auth.getUser(token)

  if (error || !user) {
    return NextResponse.json({ error: "Sessao invalida ou expirada." }, { status: 401 })
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("id,email,full_name,role,company_id")
    .eq("id", user.id)
    .maybeSingle()

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 400 })
  }

  const metadataRole = normalizeRole(user.user_metadata?.role)
  const role = ADMIN_BYPASS_EMAILS.has(user.email ?? "")
    ? "ADMIN"
    : normalizeRole(profile?.role || metadataRole)

  const fullName = profile?.full_name || user.user_metadata?.full_name || user.email || ""
  const email = profile?.email || user.email || null

  if (!profile) {
    await supabaseAdmin
      .from("profiles")
      .upsert({
        id: user.id,
        email,
        full_name: fullName,
        role,
      })
  }

  let currentCompany = null
  const { data: membership, error: membershipError } = await supabaseAdmin
    .from("company_users")
    .select("company_id, companies(id,name,legal_name,document,active,created_at)")
    .eq("user_id", user.id)
    .eq("active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!membershipError && membership?.companies) {
    currentCompany = Array.isArray(membership.companies) ? membership.companies[0] : membership.companies
  }

  if (!membershipError && !currentCompany) {
    const { data: company } = await supabaseAdmin
      .from("companies")
      .insert({
        name: companyNameFromEmail(email),
        legal_name: companyNameFromEmail(email),
      })
      .select("id,name,legal_name,document,active,created_at")
      .single()

    if (company) {
      await supabaseAdmin
        .from("company_users")
        .upsert({
          company_id: company.id,
          user_id: user.id,
          role,
          active: true,
        })

      await supabaseAdmin
        .from("profiles")
        .update({ company_id: company.id })
        .eq("id", user.id)

      currentCompany = company
    }
  }

  if (currentCompany?.id) {
    const tableNames = [
      "employees",
      "ppes",
      "deliveries",
      "workplaces",
      "stock_movements",
      "trainings",
      "job_titles",
      "departments",
      "signed_documents",
      "remote_links",
    ]

    await Promise.all(tableNames.map((tableName) =>
      supabaseAdmin
        .from(tableName)
        .update({ company_id: currentCompany.id })
        .is("company_id", null)
    ))
  }

  return NextResponse.json({
    user: {
      id: user.id,
      email,
      full_name: fullName,
      role,
      company_id: currentCompany?.id || profile?.company_id || null,
    },
    current_company: currentCompany,
  })
}
