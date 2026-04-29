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
    .select("id,email,full_name,role")
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

  return NextResponse.json({
    user: {
      id: user.id,
      email,
      full_name: fullName,
      role,
    },
  })
}
