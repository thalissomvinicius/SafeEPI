import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabaseAdmin"
import type { Profile } from "@/types/database"

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

const VALID_ROLES = new Set<AppRole>(["MASTER", "ADMIN", "ALMOXARIFE", "DIRETORIA"])

/**
 * Default seguro: nunca atribuir um role privilegiado quando o valor é
 * desconhecido. NULL faz com que requireAuthorizedUser rejeite a sessão
 * a menos que o caller seja MASTER.
 */
function normalizeRole(role: unknown): AppRole | null {
  return VALID_ROLES.has(role as AppRole) ? (role as AppRole) : null
}

/**
 * Lê role exclusivamente de fontes confiáveis (em ordem):
 *   1. app_metadata.role  — gravável apenas via service_role
 *   2. company_users      — vínculo de empresa
 *   3. profiles.role      — espelho local
 * Nunca confia em user_metadata.role (gravável pelo cliente no signup).
 */
function resolveRoleFromTrustedSources(
  appMetadataRole: unknown,
  membershipRole: unknown,
  profileRole: unknown,
): AppRole | null {
  return (
    normalizeRole(appMetadataRole) ||
    normalizeRole(membershipRole) ||
    normalizeRole(profileRole)
  )
}

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

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("role,company_id")
    .eq("id", user.id)
    .maybeSingle()

  const { data: membership } = await supabaseAdmin
    .from("company_users")
    .select("company_id,role")
    .eq("user_id", user.id)
    .eq("active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()

  const appMetadataRole = (user.app_metadata as { role?: unknown } | null | undefined)?.role
  const role = resolveRoleFromTrustedSources(
    appMetadataRole,
    membership?.role,
    profile?.role,
  )

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
      : (membership?.company_id || profile?.company_id || null) as string | null

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
