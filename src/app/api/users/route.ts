import { NextResponse } from "next/server"
import { requireAuthorizedUser } from "@/lib/serverAuth"
import { supabaseAdmin } from "@/lib/supabaseAdmin"
import type { Profile } from "@/types/database"

type AppRole = Profile["role"]

const VALID_ROLES = new Set<AppRole>(["ADMIN", "ALMOXARIFE", "DIRETORIA"])

function normalizeRole(role: unknown): AppRole {
  return VALID_ROLES.has(role as AppRole) ? role as AppRole : "ALMOXARIFE"
}

export async function GET(request: Request) {
  const auth = await requireAuthorizedUser(request, ["ADMIN"])
  if (!auth.authorized) {
    return auth.response
  }

  try {
    const { data: users, error } = await supabaseAdmin.auth.admin.listUsers()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    const { data: profiles, error: profilesError } = await supabaseAdmin
      .from("profiles")
      .select("*")

    if (profilesError) {
      return NextResponse.json({ error: profilesError.message }, { status: 400 })
    }

    const mergedUsers = users.users.map((user) => {
      const profile = profiles?.find((item) => item.id === user.id)
      return {
        id: user.id,
        email: user.email,
        full_name: profile?.full_name || "",
        role: normalizeRole(profile?.role || user.user_metadata?.role),
        created_at: user.created_at,
        last_sign_in_at: user.last_sign_in_at,
      }
    })

    return NextResponse.json({ users: mergedUsers })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Erro interno do servidor"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const auth = await requireAuthorizedUser(request, ["ADMIN"])
  if (!auth.authorized) {
    return auth.response
  }

  try {
    const { email, password, full_name, role } = await request.json()
    const normalizedRole = normalizeRole(role)

    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name, role: normalizedRole },
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
        })

      if (profileError) {
        await supabaseAdmin.auth.admin.deleteUser(authData.user.id)
        return NextResponse.json({ error: profileError.message }, { status: 400 })
      }
    }

    return NextResponse.json({ success: true, user: authData.user })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Erro interno do servidor"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  const auth = await requireAuthorizedUser(request, ["ADMIN"])
  if (!auth.authorized) {
    return auth.response
  }

  try {
    const { id, password, role, full_name } = await request.json()

    const { data: existingUserData, error: existingUserError } = await supabaseAdmin.auth.admin.getUserById(id)
    if (existingUserError || !existingUserData.user) {
      return NextResponse.json({ error: existingUserError?.message || "Usuario nao encontrado." }, { status: 404 })
    }

    const normalizedRole = role ? normalizeRole(role) : undefined
    const updates: { password?: string; user_metadata?: Record<string, unknown> } = {}
    if (password) updates.password = password
    if (full_name || normalizedRole) {
      updates.user_metadata = {
        ...(existingUserData.user.user_metadata || {}),
        ...(full_name ? { full_name } : {}),
        ...(normalizedRole ? { role: normalizedRole } : {}),
      }
    }

    if (Object.keys(updates).length > 0) {
      const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(id, updates)
      if (authError) {
        return NextResponse.json({ error: authError.message }, { status: 400 })
      }
    }

    const profileUpdates: Partial<Pick<Profile, "role" | "full_name">> = {}
    if (normalizedRole) profileUpdates.role = normalizedRole
    if (full_name) profileUpdates.full_name = full_name

    if (Object.keys(profileUpdates).length > 0) {
      const { error: profileError } = await supabaseAdmin
        .from("profiles")
        .upsert({
          id,
          email: existingUserData.user.email ?? null,
          full_name: existingUserData.user.user_metadata?.full_name || null,
          role: normalizeRole(existingUserData.user.user_metadata?.role),
          ...profileUpdates,
        })

      if (profileError) {
        return NextResponse.json({ error: profileError.message }, { status: 400 })
      }
    }

    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Erro interno do servidor"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  const auth = await requireAuthorizedUser(request, ["ADMIN"])
  if (!auth.authorized) {
    return auth.response
  }

  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get("id")

    if (!id) {
      return NextResponse.json({ error: "ID não fornecido" }, { status: 400 })
    }

    const { error } = await supabaseAdmin.auth.admin.deleteUser(id)
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Erro interno do servidor"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
