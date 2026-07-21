import { NextResponse } from "next/server"
import { requireAuthorizedUser } from "@/lib/serverAuth"
import { getClientIp } from "@/lib/getClientIp"
import { rateLimit, rateLimitExceededResponse } from "@/lib/rateLimit"
import { supabaseAdmin } from "@/lib/supabaseAdmin"

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TOKEN_REGEX = /^[0-9a-f]{64}$/i
const REASONS = new Set(["repeated_failure", "low_variance", "timeout"])

function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_REGEX.test(value)
}

function isValidToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_REGEX.test(value)
}

async function resolveCompanyFromRemoteToken(token: string, employeeId: string) {
  const { data: link } = await supabaseAdmin
    .from("remote_links")
    .select("employee_id, company_id, status, expires_at")
    .eq("token", token)
    .maybeSingle()

  if (!link) return null
  if (link.employee_id !== employeeId) return null
  if (new Date(link.expires_at) < new Date()) return null
  if (link.status !== "pending") return null

  return (link.company_id as string | null) || null
}

export async function POST(request: Request) {
  const ip = getClientIp(request)
  const limited = await rateLimit(`biometric-suspicious:${ip}`, 30, 60 * 60 * 1000)
  if (!limited.success) return rateLimitExceededResponse(limited.retryAfter)

  try {
    const body = await request.json()
    const employeeId = body?.employee_id
    const token = body?.token
    const attempts = Number.isFinite(Number(body?.attempts))
      ? Math.max(1, Math.min(100, Math.floor(Number(body.attempts))))
      : 1
    const reason = String(body?.reason || "")

    if (!isValidUuid(employeeId)) {
      return NextResponse.json({ error: "employee_id invalido." }, { status: 400 })
    }
    if (!REASONS.has(reason)) {
      return NextResponse.json({ error: "Motivo invalido." }, { status: 400 })
    }

    let companyId: string | null = null
    if (isValidToken(token)) {
      companyId = await resolveCompanyFromRemoteToken(token, employeeId)
      if (!companyId) {
        return NextResponse.json({ error: "Token remoto invalido." }, { status: 401 })
      }
    } else {
      const auth = await requireAuthorizedUser(request)
      if (!auth.authorized) return auth.response

      let employeeQuery = supabaseAdmin
        .from("employees")
        .select("company_id")
        .eq("id", employeeId)

      if (auth.user.role !== "MASTER") {
        if (!auth.user.company_id) {
          return NextResponse.json({ error: "Empresa atual nao identificada." }, { status: 403 })
        }
        employeeQuery = employeeQuery.eq("company_id", auth.user.company_id)
      }

      const { data: employee, error } = await employeeQuery.maybeSingle()
      if (error) {
        console.error("[biometric suspicious] employee lookup error:", error)
        return NextResponse.json({ error: "Falha ao registrar tentativa." }, { status: 500 })
      }
      if (!employee) {
        return NextResponse.json({ error: "Colaborador nao encontrado." }, { status: 404 })
      }

      companyId = (employee.company_id as string | null) || auth.user.company_id
    }

    const { error: insertError } = await supabaseAdmin
      .from("biometric_suspicious_log")
      .insert({
        employee_id: employeeId,
        company_id: companyId,
        attempts,
        reason,
        ip: typeof body?.ip === "string" && body.ip ? body.ip : ip,
      })

    if (insertError) {
      console.error("[biometric suspicious] insert error:", insertError)
      return NextResponse.json({ error: "Falha ao registrar tentativa." }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[biometric suspicious] unexpected error:", error)
    return NextResponse.json({ error: "Erro interno do servidor." }, { status: 500 })
  }
}
