import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabaseAdmin"
import type { Profile } from "@/types/database"
import { resolveAuthorizedRole } from "@/lib/authorizedRole"

type AppRole = Profile["role"]

type AuthorizedUser = {
  id: string
  email: string | null
  role: AppRole
  company_id: string | null
}

type AuthorizationResult =
  | { authorized: true; user: AuthorizedUser }
  | { authorized: false; response: NextResponse }

export async function requireAuthorizedUser(
  request: Request,
  allowedRoles?: AppRole[],
): Promise<AuthorizationResult> {
  const authHeader = request.headers.get("authorization")
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null

  if (!token) {
    return {
      authorized: false,
      response: NextResponse.json({ error: "Sessão não informada." }, { status: 401 }),
    }
  }

  const {
    data: { user },
    error,
  } = await supabaseAdmin.auth.getUser(token)

  if (error || !user) {
    return {
      authorized: false,
      response: NextResponse.json({ error: "Sessão inválida ou expirada." }, { status: 401 }),
    }
  }

  const appMetadataRole = (user.app_metadata as { role?: unknown } | null | undefined)?.role
  const { data: profile, error: profileError } = appMetadataRole === "MASTER"
    ? { data: null, error: null }
    : await supabaseAdmin.from("profiles").select("role").eq("id", user.id).maybeSingle()
  if (profileError) {
    return {
      authorized: false,
      response: NextResponse.json({ error: "Falha ao validar perfil. Tente novamente." }, { status: 503 }),
    }
  }
  const isPlatformMaster = resolveAuthorizedRole(appMetadataRole, null, profile?.role) === "MASTER"
  const { data: membership, error: membershipError } = isPlatformMaster
    ? { data: null, error: null }
    : await supabaseAdmin
    .from("company_users")
    .select("company_id,role")
    .eq("user_id", user.id)
    .eq("active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()

  if (membershipError) {
    return {
      authorized: false,
      response: NextResponse.json({ error: "Falha ao validar vínculo com a empresa. Tente novamente." }, { status: 503 }),
    }
  }

  const role = resolveAuthorizedRole(appMetadataRole, membership?.role, profile?.role)

  // Sem role válido em fonte confiável → não autorizado.
  if (!role) {
    return {
      authorized: false,
      response: NextResponse.json(
        { error: "Conta sem permissão configurada. Contate o administrador." },
        { status: 403 },
      ),
    }
  }

  const companyId =
    role === "MASTER"
      ? null
      : (membership?.company_id || null) as string | null

  // Usuário não-master tem que estar vinculado a uma empresa ativa.
  if (role !== "MASTER" && !companyId) {
    return {
      authorized: false,
      response: NextResponse.json(
        { error: "Usuário sem empresa ativa associada." },
        { status: 403 },
      ),
    }
  }

  if (companyId) {
    const { data: company, error: companyError } = await supabaseAdmin
      .from("companies")
      .select("active,subscription_status")
      .eq("id", companyId)
      .maybeSingle()

    if (companyError) {
      return {
        authorized: false,
        response: NextResponse.json({ error: "Falha ao validar empresa." }, { status: 500 }),
      }
    }

    if (!company?.active || company?.subscription_status === "SUSPENDED") {
      return {
        authorized: false,
        response: NextResponse.json(
          { error: "Acesso da empresa desativado. Entre em contato com o suporte SafeEPI." },
          { status: 403 },
        ),
      }
    }
  }

  if (allowedRoles && !allowedRoles.includes(role)) {
    return {
      authorized: false,
      response: NextResponse.json({ error: "Acesso negado." }, { status: 403 }),
    }
  }

  return {
    authorized: true,
    user: {
      id: user.id,
      email: user.email ?? null,
      role,
      company_id: companyId,
    },
  }
}

/**
 * Helper para garantir que o usuário-alvo de uma operação cross-user
 * (PUT/DELETE em /api/users) pertence à mesma empresa do caller.
 * Retorna null se não há vínculo ativo, ou se o caller é MASTER (sem
 * restrição de tenant).
 */
export async function getTargetUserCompanyId(targetUserId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("company_users")
    .select("company_id")
    .eq("user_id", targetUserId)
    .eq("active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()

  return (data?.company_id as string | null) || null
}

export async function ensureSameCompany(
  caller: AuthorizedUser,
  targetUserId: string,
): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  if (caller.role === "MASTER") return { ok: true }

  const targetCompanyId = await getTargetUserCompanyId(targetUserId)
  if (!targetCompanyId) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Usuário-alvo não encontrado ou sem empresa." },
        { status: 404 },
      ),
    }
  }

  if (targetCompanyId !== caller.company_id) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Operação fora do escopo da sua empresa." },
        { status: 403 },
      ),
    }
  }

  return { ok: true }
}
