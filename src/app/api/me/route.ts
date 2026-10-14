import { NextResponse } from "next/server"
import { getSupabaseAdminConfigError, supabaseAdmin } from "@/lib/supabaseAdmin"
import { signStorageValue } from "@/lib/privateStorage"
import type { Company } from "@/types/database"
import { resolveAuthorizedRole } from "@/lib/authorizedRole"

async function loadActiveMembership(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("company_users")
    .select("company_id, role, company:companies(*)")
    .eq("user_id", userId)
    .eq("active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error) return { membership: null, error }
  if (!data?.company_id) return { membership: null, error: null }

  const company = Array.isArray(data.company) ? data.company[0] || null : data.company
  return {
    membership: {
      companyId: data.company_id as string,
      company: (company as unknown as Company | null) ?? null,
      role: data.role,
    },
    error: null,
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
  const isPlatformMaster = resolveAuthorizedRole(appMetadataRole, null, profile?.role) === "MASTER"
  const { membership, error: membershipError } = isPlatformMaster
    ? { membership: null, error: null }
    : await loadActiveMembership(user.id)
  if (membershipError) {
    return NextResponse.json({ error: "Falha ao validar vínculo com a empresa. Tente novamente." }, { status: 503 })
  }
  const role = resolveAuthorizedRole(appMetadataRole, membership?.role, profile?.role)

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

  if (role !== "MASTER" && (!company?.active || company.subscription_status === "SUSPENDED")) {
    return NextResponse.json(
      { error: "Acesso da empresa desativado. Entre em contato com o suporte SafeEPI." },
      { status: 403 },
    )
  }

  const fullName = profile?.full_name || user.user_metadata?.full_name || user.email || ""
  const email = profile?.email || user.email || null
  const signedCompany = company
    ? {
        ...company,
        logo_storage_path: company.logo_url || null,
        logo_url: await signStorageValue(company.logo_url),
      }
    : null

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
      company: signedCompany,
    },
  })
}
