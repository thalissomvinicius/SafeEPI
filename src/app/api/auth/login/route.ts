import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { getClientIp } from "@/lib/getClientIp"
import { rateLimit, rateLimitExceededResponse } from "@/lib/rateLimit"

const LOGIN_LIMIT = 5
const LOGIN_WINDOW_MS = 15 * 60 * 1000

export async function POST(request: Request) {
  const ip = getClientIp(request)
  const limited = rateLimit(`auth:login:ip:${ip}`, LOGIN_LIMIT, LOGIN_WINDOW_MS)
  if (!limited.success) return rateLimitExceededResponse(limited.retryAfter)

  try {
    const { email, password } = await request.json()
    if (typeof email !== "string" || typeof password !== "string") {
      return NextResponse.json({ error: "Credenciais invalidas." }, { status: 400 })
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!supabaseUrl || !anonKey) {
      return NextResponse.json({ error: "Configuracao de autenticacao ausente." }, { status: 500 })
    }

    const supabase = createClient(supabaseUrl, anonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      console.error("[/api/auth/login] auth error:", error)
      return NextResponse.json({ error: "Credenciais invalidas." }, { status: 401 })
    }

    return NextResponse.json({ session: data.session, user: data.user })
  } catch (error) {
    console.error("[/api/auth/login] error:", error)
    return NextResponse.json({ error: "Erro interno ao autenticar." }, { status: 500 })
  }
}
