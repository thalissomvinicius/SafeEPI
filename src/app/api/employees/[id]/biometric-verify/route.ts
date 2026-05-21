import { NextResponse } from "next/server"
import { requireAuthorizedUser } from "@/lib/serverAuth"
import { supabaseAdmin } from "@/lib/supabaseAdmin"
import { getClientIp } from "@/lib/getClientIp"
import { rateLimit, rateLimitExceededResponse } from "@/lib/rateLimit"
import type { EmployeeBiometric } from "@/types/biometric"

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TOKEN_REGEX = /^[0-9a-f]{64}$/i
const FACE_MATCH_THRESHOLD = 0.55
const MIN_DESCRIPTOR_LENGTH = 64
const MAX_DESCRIPTOR_LENGTH = 1024

type RouteContext = {
  params: Promise<{ id: string }>
}

function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_REGEX.test(value)
}

function isValidToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_REGEX.test(value)
}

function isValidDescriptor(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length >= MIN_DESCRIPTOR_LENGTH &&
    value.length <= MAX_DESCRIPTOR_LENGTH &&
    value.every((item) => typeof item === "number" && Number.isFinite(item))
  )
}

function euclideanDistance(current: number[], stored: number[]) {
  const length = Math.min(current.length, stored.length)
  if (length === 0) return Number.POSITIVE_INFINITY

  let sum = 0
  for (let index = 0; index < length; index += 1) {
    const delta = current[index] - stored[index]
    sum += delta * delta
  }
  return Math.sqrt(sum)
}

function confidenceFromDistance(distance: number) {
  if (!Number.isFinite(distance)) return 0
  return Math.max(0, Math.min(1, 1 - distance / FACE_MATCH_THRESHOLD))
}

async function validateRemoteToken(token: string, employeeId: string) {
  const { data: link } = await supabaseAdmin
    .from("remote_links")
    .select("employee_id, company_id, status, expires_at")
    .eq("token", token)
    .maybeSingle()

  if (!link) return { ok: false as const, status: 404, error: "Link remoto nao encontrado." }
  if (link.employee_id !== employeeId) {
    return { ok: false as const, status: 403, error: "Link remoto nao pertence ao colaborador." }
  }
  if (new Date(link.expires_at) < new Date()) {
    return { ok: false as const, status: 410, error: "Link remoto expirado." }
  }
  if (link.status !== "pending") {
    return { ok: false as const, status: 410, error: "Link remoto ja utilizado." }
  }

  return { ok: true as const, companyId: link.company_id as string | null }
}

export async function POST(request: Request, context: RouteContext) {
  const { id } = await Promise.resolve(context.params)
  const limited = rateLimit(`biometric-verify:${id}:${getClientIp(request)}`, 60, 60 * 60 * 1000)
  if (!limited.success) return rateLimitExceededResponse(limited.retryAfter)

  try {
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: "ID do colaborador invalido." }, { status: 400 })
    }

    const body = await request.json()
    const descriptor = body?.descriptor
    const token = body?.token

    if (!isValidDescriptor(descriptor)) {
      return NextResponse.json({ error: "Descritor facial invalido." }, { status: 400 })
    }

    let companyIdScope: string | null = null
    if (isValidToken(token)) {
      const remote = await validateRemoteToken(token, id)
      if (!remote.ok) {
        return NextResponse.json({ error: remote.error }, { status: remote.status })
      }
      companyIdScope = remote.companyId
    } else {
      const auth = await requireAuthorizedUser(request)
      if (!auth.authorized) return auth.response
      companyIdScope = auth.user.role === "MASTER" ? null : auth.user.company_id
    }

    let query = supabaseAdmin
      .from("employees")
      .select("id, company_id, face_descriptor")
      .eq("id", id)

    if (companyIdScope) query = query.eq("company_id", companyIdScope)

    const { data: employee, error } = await query.maybeSingle<EmployeeBiometric>()

    if (error) {
      console.error("[biometric-verify] employee lookup error:", error)
      return NextResponse.json({ error: "Falha ao validar biometria." }, { status: 500 })
    }

    if (!employee?.face_descriptor?.length) {
      return NextResponse.json({ match: false, confidence: 0 })
    }

    const distance = euclideanDistance(descriptor, employee.face_descriptor)
    const match = distance < FACE_MATCH_THRESHOLD

    return NextResponse.json({
      match,
      confidence: confidenceFromDistance(distance),
    })
  } catch (error) {
    console.error("[biometric-verify] unexpected error:", error)
    return NextResponse.json({ error: "Erro interno do servidor." }, { status: 500 })
  }
}
