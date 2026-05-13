import { NextResponse } from "next/server"
import { getSupabaseAdminConfigError, supabaseAdmin } from "@/lib/supabaseAdmin"
import type { Company, Profile } from "@/types/database"

type AppRole = Profile["role"]

const VALID_ROLES = new Set<AppRole>(["MASTER", "ADMIN", "ALMOXARIFE", "DIRETORIA"])

/**
 * Retorna AppRole se o valor for um role válido, ou null caso contrário.
 * NUNCA defaulta para um role privilegiado.
 */
function normalizeRole(role: unknown): AppRole | null {
  return VALID_ROLES.has(role as AppRole) ? (role as AppRole) : null
}

async function loadActiveMembership(userId: string) {
  const { data } = await supabaseAdmin
    .from("company_users")
    .select("company_id, role, company:companies(*)")
    .eq("user_id", userId)
    .eq("active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!data?.company_id) return null

  const company = Array.isArray(data.company) ? data.company[0] || null : data.company
  return {
    companyId: data.company_id as string,
    company: (company as unknown as Company | null) ?? null,
    role: normalizeRole(data.role),
  }
}

export async function GET(request: Request) {
  const configError = getSupabaseAdminConfigError()
  if (configError) {
    return NextResponse.json({ error: configError }, { status: 500 })
  }

  const authHeader = request.headers.get("authorization")
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null

  if (!token) {
    return NextResponse.json({ error: "Sessão não informada." }, { status: 401 })
  }

  const {
    data: { user },
    error,
  } = await supabaseAdmin.auth.getUser(token)

  if (error || !user) {
    return NextResponse.json({ error: "Sessão inválida ou expirada." }, { status: 401 })
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("id,email,full_name,role,company_id")
    .eq("id", user.id)
    .maybeSingle()

  if (profileError) {
    console.error("[/api/me] profile fetch error:", profileError)
    return NextResponse.json({ error: "Falha ao carregar perfil." }, { status: 500 })
  }

  // Resolução de role — apenas fontes confiáveis. user_metadata é IGNORADO.
  const appMetadataRole = (user.app_metadata as { role?: unknown } | null | undefined)?.role
  const membership = await loadActiveMembership(user.id)
  const role =
    normalizeRole(appMetadataRole) ||
    membership?.role ||
    normalizeRole(profile?.role)

  if (!role) {
    return NextResponse.json(
      { error: "Conta sem permissão configurada. Contate o administrador." },
      { status: 403 },
    )
  }

  let companyId: string | null = null
  let company: Company | null = null

  if (role === "MASTER") {
    companyId = null
    company = null
  } else {
    if (!membership) {
      // Não auto-cria empresa silenciosamente. Bloqueio explícito:
      // a empresa precisa ser criada por um MASTER via /api/companies.
      return NextResponse.json(
        { error: "Usuário não vinculado a nenhuma empresa. Contate o administrador." },
        { status: 403 },
      )
    }
    companyId = membership.companyId
    company = membership.company
  }

  if (company && (!company.active || company.subscription_status === "SUSPENDED")) {
    return NextResponse.json(
      { error: "Acesso da empresa desativado. Entre em contato com o suporte SafeEPI." },
      { status: 403 },
    )
  }

  const fullName = profile?.full_name || user.user_metadata?.full_name || user.email || ""
  const email = profile?.email || user.email || null

  // Mantém profiles em sincronia com a fonte autoritativa (membership).
  if (!profile) {
    await supabaseAdmin
      .from("profiles")
      .upsert({
        id: user.id,
        email,
        full_name: fullName,
        role,
        company_id: companyId,
      })
  } else if (profile.company_id !== companyId || profile.role !== role) {
    await supabaseAdmin
      .from("profiles")
      .update({ company_id: companyId, role })
      .eq("id", user.id)
  }

  return NextResponse.json({
    user: {
      id: user.id,
      email,
      full_name: fullName,
      role,
      company_id: companyId,
      company,
    },
  })
}
