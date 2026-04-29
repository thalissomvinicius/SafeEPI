import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabaseAdmin"
import type { Company, Profile } from "@/types/database"

type AppRole = Profile["role"]

const VALID_ROLES = new Set<AppRole>(["ADMIN", "ALMOXARIFE", "DIRETORIA"])
const ADMIN_BYPASS_EMAILS = new Set([
  "thalissomvinicius7@gmail.com",
  "thalissom.cruz@VALLE.br",
])

function normalizeRole(role: unknown): AppRole {
  return VALID_ROLES.has(role as AppRole) ? role as AppRole : "ALMOXARIFE"
}

async function ensureUserCompany(user: { id: string; email?: string | null }, role: AppRole) {
  const { data: existingMembership, error: membershipError } = await supabaseAdmin
    .from("company_users")
    .select("company_id, role, company:companies(*)")
    .eq("user_id", user.id)
    .eq("active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()

  if (membershipError) {
    throw membershipError
  }

  if (existingMembership?.company_id) {
    const company = Array.isArray(existingMembership.company)
      ? existingMembership.company[0] || null
      : existingMembership.company

    return {
      companyId: existingMembership.company_id as string,
      company: company as unknown as Company | null,
      role: normalizeRole(existingMembership.role || role),
    }
  }

  const companyName = user.email?.split("@")[1]?.split(".")[0]
    ? `${user.email.split("@")[1].split(".")[0].toUpperCase()} - SafeEPI`
    : "Empresa SafeEPI"

  const { data: company, error: companyError } = await supabaseAdmin
    .from("companies")
    .insert({
      name: companyName,
      trade_name: companyName,
      primary_color: "#2563EB",
      active: true,
    })
    .select("*")
    .single()

  if (companyError) {
    throw companyError
  }

  const { error: userCompanyError } = await supabaseAdmin
    .from("company_users")
    .insert({
      company_id: company.id,
      user_id: user.id,
      role,
      active: true,
    })

  if (userCompanyError) {
    throw userCompanyError
  }

  return {
    companyId: company.id as string,
    company: company as Company,
    role,
  }
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
  const companyContext = await ensureUserCompany({ id: user.id, email }, role)

  if (!profile) {
    await supabaseAdmin
      .from("profiles")
      .upsert({
        id: user.id,
        email,
        full_name: fullName,
        role: companyContext.role,
        company_id: companyContext.companyId,
      })
  } else if (!profile.company_id || profile.company_id !== companyContext.companyId || profile.role !== companyContext.role) {
    await supabaseAdmin
      .from("profiles")
      .update({
        company_id: companyContext.companyId,
        role: companyContext.role,
      })
      .eq("id", user.id)
  }

  return NextResponse.json({
    user: {
      id: user.id,
      email,
      full_name: fullName,
      role: companyContext.role,
      company_id: companyContext.companyId,
      company: companyContext.company,
    },
  })
}
