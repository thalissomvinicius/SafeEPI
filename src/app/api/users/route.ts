import { NextResponse } from "next/server"
import { ensureSameCompany, getTargetUserCompanyId, requireAuthorizedUser } from "@/lib/serverAuth"
import { supabaseAdmin } from "@/lib/supabaseAdmin"
import type { Profile } from "@/types/database"

type AppRole = Profile["role"]

const VALID_ROLES = new Set<AppRole>(["MASTER", "ADMIN", "ALMOXARIFE", "DIRETORIA"])
const COMPANY_ROLES = new Set<AppRole>(["ADMIN", "ALMOXARIFE", "DIRETORIA"])

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function normalizeRole(role: unknown): AppRole | null {
  return VALID_ROLES.has(role as AppRole) ? (role as AppRole) : null
}

function normalizeCompanyRole(role: unknown): AppRole | null {
  const normalized = normalizeRole(role)
  return normalized && COMPANY_ROLES.has(normalized) ? normalized : null
}

function resolveTargetCompanyId(
  authUser: { role: AppRole; company_id: string | null },
  requestedCompanyId: string | null,
) {
  if (authUser.role === "MASTER") return requestedCompanyId
  return authUser.company_id
}

function isValidEmail(value: unknown): value is string {
  return typeof value === "string" && EMAIL_REGEX.test(value) && value.length <= 254
}

function isValidPassword(value: unknown): value is string {
  return typeof value === "string" && value.length >= 8 && value.length <= 256
}

function isValidName(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 200
}

export async function GET(request: Request) {
  const auth = await requireAuthorizedUser(request, ["MASTER", "ADMIN"])
  if (!auth.authorized) return auth.response

  try {
    const { searchParams } = new URL(request.url)
    const targetCompanyId = resolveTargetCompanyId(auth.user, searchParams.get("company_id"))

    if (!targetCompanyId) {
      return NextResponse.json({ error: "Empresa não informada." }, { status: 400 })
    }

    // ADMIN só pode listar usuários da PRÓPRIA empresa.
    if (auth.user.role === "ADMIN" && targetCompanyId !== auth.user.company_id) {
      return NextResponse.json({ error: "Operação fora do escopo da sua empresa." }, { status: 403 })
    }

    const { data: profiles, error: profilesError } = await supabaseAdmin
      .from("profiles")
      .select("*")
      .eq("company_id", targetCompanyId)

    if (profilesError) {
      console.error("[/api/users][GET] profiles error:", profilesError)
      return NextResponse.json({ error: "Falha ao carregar usuários." }, { status: 500 })
    }

    // Buscamos auth.users só para os IDs do tenant — evita listar usuários
    // de outras empresas como acontecia na implementação anterior.
    const profileIds = (profiles || []).map((p) => p.id)
    const enriched = await Promise.all(
      profileIds.map(async (id) => {
        const { data } = await supabaseAdmin.auth.admin.getUserById(id)
        return data?.user
      }),
    )

    const mergedUsers = (profiles || []).map((profile) => {
      const authUser = enriched.find((u) => u?.id === profile.id)
      return {
        id: profile.id,
        email: authUser?.email ?? profile.email,
        full_name: profile.full_name || "",
        role: normalizeRole(profile.role) || "ALMOXARIFE",
        created_at: authUser?.created_at,
        last_sign_in_at: authUser?.last_sign_in_at,
      }
    })

    return NextResponse.json({ users: mergedUsers })
  } catch (err: unknown) {
    console.error("[/api/users][GET] unexpected error:", err)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const auth = await requireAuthorizedUser(request, ["MASTER", "ADMIN"])
  if (!auth.authorized) return auth.response

  try {
    const { email, password, full_name, role, company_id } = await request.json()
    const normalizedRole = normalizeCompanyRole(role)
    const targetCompanyId = resolveTargetCompanyId(auth.user, company_id || null)

    if (!isValidEmail(email)) {
      return NextResponse.json({ error: "E-mail inválido." }, { status: 400 })
    }
    if (!isValidPassword(password)) {
      return NextResponse.json({ error: "Senha inválida (mínimo 8 caracteres)." }, { status: 400 })
    }
    if (!isValidName(full_name)) {
      return NextResponse.json({ error: "Nome do usuário é obrigatório." }, { status: 400 })
    }
    if (!normalizedRole) {
      return NextResponse.json({ error: "Role inválido." }, { status: 400 })
    }
    if (!targetCompanyId) {
      return NextResponse.json({ error: "Empresa não informada para este usuário." }, { status: 400 })
    }

    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      // app_metadata é a fonte confiável; user_metadata fica apenas para
      // campos cosméticos (full_name).
      app_metadata: { role: normalizedRole, company_id: targetCompanyId },
      user_metadata: { full_name },
    })

    if (authError) {
      return NextResponse.json({ error: authError.message }, { status: 400 })
    }

    if (authData.user) {
      const { error: profileError } = await supabaseAdmin
        .from("profiles")
        .upsert({
          id: authData.user.id,
          email,
          full_name,
          role: normalizedRole,
          company_id: targetCompanyId,
        })

      if (profileError) {
        await supabaseAdmin.auth.admin.deleteUser(authData.user.id)
        return NextResponse.json({ error: "Falha ao criar perfil do usuário." }, { status: 500 })
      }

      const { error: companyUserError } = await supabaseAdmin
        .from("company_users")
        .upsert(
          {
            company_id: targetCompanyId,
            user_id: authData.user.id,
            role: normalizedRole,
            active: true,
          },
          { onConflict: "company_id,user_id" },
        )

      if (companyUserError) {
        await supabaseAdmin.auth.admin.deleteUser(authData.user.id)
        return NextResponse.json({ error: "Falha ao vincular usuário à empresa." }, { status: 500 })
      }
    }

    return NextResponse.json({ success: true, user: { id: authData.user?.id, email } })
  } catch (err: unknown) {
    console.error("[/api/users][POST] unexpected error:", err)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  const auth = await requireAuthorizedUser(request, ["MASTER", "ADMIN"])
  if (!auth.authorized) return auth.response

  try {
    const { id, password, role, full_name } = await request.json()

    if (typeof id !== "string" || !id) {
      return NextResponse.json({ error: "Usuário não informado." }, { status: 400 })
    }

    // CRÍTICO: ADMIN só pode editar usuários da PRÓPRIA empresa.
    const sameCompany = await ensureSameCompany(auth.user, id)
    if (!sameCompany.ok) return sameCompany.response

    const targetCompanyId = await getTargetUserCompanyId(id)

    const { data: existingUserData, error: existingUserError } = await supabaseAdmin.auth.admin.getUserById(id)
    if (existingUserError || !existingUserData.user) {
      return NextResponse.json({ error: "Usuário não encontrado." }, { status: 404 })
    }

    const normalizedRole = role !== undefined ? normalizeCompanyRole(role) : undefined
    if (role !== undefined && !normalizedRole) {
      return NextResponse.json({ error: "Role inválido." }, { status: 400 })
    }
    if (password !== undefined && !isValidPassword(password)) {
      return NextResponse.json({ error: "Senha inválida (mínimo 8 caracteres)." }, { status: 400 })
    }
    if (full_name !== undefined && !isValidName(full_name)) {
      return NextResponse.json({ error: "Nome inválido." }, { status: 400 })
    }

    // Atualizações em auth.users
    const authUpdates: {
      password?: string
      app_metadata?: Record<string, unknown>
      user_metadata?: Record<string, unknown>
    } = {}
    if (password) authUpdates.password = password
    if (normalizedRole) {
      authUpdates.app_metadata = {
        ...((existingUserData.user.app_metadata as Record<string, unknown>) || {}),
        role: normalizedRole,
        ...(targetCompanyId ? { company_id: targetCompanyId } : {}),
      }
    }
    if (full_name) {
      authUpdates.user_metadata = {
        ...(existingUserData.user.user_metadata || {}),
        full_name,
      }
    }

    if (Object.keys(authUpdates).length > 0) {
      const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(id, authUpdates)
      if (authError) {
        return NextResponse.json({ error: "Falha ao atualizar credenciais." }, { status: 500 })
      }
    }

    // Atualizações em profiles
    const profileUpdates: Partial<Pick<Profile, "role" | "full_name">> = {}
    if (normalizedRole) profileUpdates.role = normalizedRole
    if (full_name) profileUpdates.full_name = full_name

    if (Object.keys(profileUpdates).length > 0) {
      const { error: profileError } = await supabaseAdmin
        .from("profiles")
        .update(profileUpdates)
        .eq("id", id)

      if (profileError) {
        return NextResponse.json({ error: "Falha ao atualizar perfil." }, { status: 500 })
      }
    }

    // Atualizações em company_users (apenas se mudou role)
    if (normalizedRole && targetCompanyId) {
      const { error: companyUserError } = await supabaseAdmin
        .from("company_users")
        .update({ role: normalizedRole })
        .eq("user_id", id)
        .eq("company_id", targetCompanyId)

      if (companyUserError) {
        return NextResponse.json({ error: "Falha ao atualizar vínculo da empresa." }, { status: 500 })
      }
    }

    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    console.error("[/api/users][PUT] unexpected error:", err)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  const auth = await requireAuthorizedUser(request, ["MASTER", "ADMIN"])
  if (!auth.authorized) return auth.response

  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get("id")

    if (!id) {
      return NextResponse.json({ error: "ID não fornecido" }, { status: 400 })
    }

    if (id === auth.user.id) {
      return NextResponse.json({ error: "Você não pode excluir a própria conta." }, { status: 400 })
    }

    // CRÍTICO: ADMIN só pode excluir usuários da PRÓPRIA empresa.
    const sameCompany = await ensureSameCompany(auth.user, id)
    if (!sameCompany.ok) return sameCompany.response

    const { error } = await supabaseAdmin.auth.admin.deleteUser(id)
    if (error) {
      return NextResponse.json({ error: "Falha ao excluir usuário." }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    console.error("[/api/users][DELETE] unexpected error:", err)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}
