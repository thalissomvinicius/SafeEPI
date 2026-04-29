import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabaseAdmin"
import type { Profile } from "@/types/database"

type AppRole = Profile["role"]

type AuthorizationResult =
  | {
      authorized: true
      user: {
        id: string
        email: string | null
        role: AppRole
      }
    }
  | {
      authorized: false
      response: NextResponse
    }

const ADMIN_BYPASS_EMAILS = new Set([
  "thalissomvinicius7@gmail.com",
  "thalissom.cruz@VALLE.br",
])

const VALID_ROLES = new Set<AppRole>(["ADMIN", "ALMOXARIFE", "DIRETORIA"])

function normalizeRole(role: unknown): AppRole {
  return VALID_ROLES.has(role as AppRole) ? role as AppRole : "ALMOXARIFE"
}

export async function requireAuthorizedUser(
  request: Request,
  allowedRoles?: AppRole[]
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
    .select("role")
    .eq("id", user.id)
    .maybeSingle()

  const fallbackRole = normalizeRole(user.user_metadata?.role)
  const role = (
    ADMIN_BYPASS_EMAILS.has(user.email ?? "")
      ? "ADMIN"
      : normalizeRole(profile?.role || fallbackRole)
  ) as AppRole

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
    },
  }
}
