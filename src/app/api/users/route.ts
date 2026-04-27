import { NextResponse } from "next/server"
import { requireAuthorizedUser } from "@/lib/serverAuth"
import { supabaseAdmin } from "@/lib/supabaseAdmin"
import type { Profile } from "@/types/database"

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
        role: profile?.role || "USER",
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

    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
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
          role,
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

    const updates: { password?: string; user_metadata?: { full_name: string } } = {}
    if (password) updates.password = password
    if (full_name) updates.user_metadata = { full_name }

    if (Object.keys(updates).length > 0) {
      const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(id, updates)
      if (authError) {
        return NextResponse.json({ error: authError.message }, { status: 400 })
      }
    }

    const profileUpdates: Partial<Pick<Profile, "role" | "full_name">> = {}
    if (role) profileUpdates.role = role
    if (full_name) profileUpdates.full_name = full_name

    if (Object.keys(profileUpdates).length > 0) {
      const { error: profileError } = await supabaseAdmin
        .from("profiles")
        .update(profileUpdates)
        .eq("id", id)

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
