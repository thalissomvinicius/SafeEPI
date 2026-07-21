import { createServerClient, type CookieOptions } from "@supabase/ssr"
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { getClientIp } from "@/lib/getClientIp"
import { rateLimit, rateLimitExceededResponse } from "@/lib/rateLimit"
import { readJsonWithLimit, RequestTooLargeError } from "@/lib/requestSecurity"

const LOGIN_LIMIT = 5
const LOGIN_WINDOW_MS = 15 * 60 * 1000

const credentialsSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(1024),
})

type PendingCookie = { name: string; value: string; options: CookieOptions }

export async function POST(request: NextRequest) {
  const ip = getClientIp(request)
  const limited = await rateLimit(`auth:login:ip:${ip}`, LOGIN_LIMIT, LOGIN_WINDOW_MS)
  if (!limited.success) return rateLimitExceededResponse(limited.retryAfter)

  try {
    const parsed = credentialsSchema.safeParse(await readJsonWithLimit(request, 8 * 1024))
    if (!parsed.success) {
      return NextResponse.json({ error: "Credenciais invalidas." }, { status: 400 })
    }
    const { email, password } = parsed.data

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!supabaseUrl || !anonKey) {
      return NextResponse.json({ error: "Configuracao de autenticacao ausente." }, { status: 500 })
    }

    const pendingCookies: PendingCookie[] = []
    const pendingHeaders = new Headers()
    const supabase = createServerClient(supabaseUrl, anonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet, headersToSet) {
          pendingCookies.push(...cookiesToSet)
          Object.entries(headersToSet).forEach(([name, value]) => {
            pendingHeaders.set(name, value)
          })
        },
      },
    })
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      console.error("[/api/auth/login] auth error:", error)
      return NextResponse.json({ error: "Credenciais invalidas." }, { status: 401 })
    }

    const response = NextResponse.json({ user: data.user })
    pendingCookies.forEach(({ name, value, options }) => {
      response.cookies.set(name, value, options)
    })
    pendingHeaders.forEach((value, name) => {
      response.headers.set(name, value)
    })
    return response
  } catch (error) {
    if (error instanceof RequestTooLargeError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("[/api/auth/login] error:", error)
    return NextResponse.json({ error: "Erro interno ao autenticar." }, { status: 500 })
  }
}
