import { NextResponse } from "next/server"
import { requireAuthorizedUser } from "@/lib/serverAuth"
import { supabaseAdmin } from "@/lib/supabaseAdmin"
import { getClientIp } from "@/lib/getClientIp"
import { rateLimit, rateLimitExceededResponse } from "@/lib/rateLimit"
import { loadEmployeeReferenceEmbedding } from "@/lib/serverBiometric"
import { readJsonWithLimit, RequestTooLargeError } from "@/lib/requestSecurity"

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TOKEN_REGEX = /^[0-9a-f]{64}$/i
const FACE_MATCH_THRESHOLD = 0.4
const MIN_DESCRIPTOR_LENGTH = 512
const MAX_DESCRIPTOR_LENGTH = 512

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

function cosineSimilarity(current: number[], stored: number[]) {
  const length = Math.min(current.length, stored.length)
  if (length === 0) return 0

  let dot = 0
  let currentNorm = 0
  let storedNorm = 0
  for (let index = 0; index < length; index += 1) {
    dot += current[index] * stored[index]
    currentNorm += current[index] * current[index]
    storedNorm += stored[index] * stored[index]
  }
  const denominator = Math.sqrt(currentNorm) * Math.sqrt(storedNorm)
  return denominator ? dot / denominator : 0
}

function confidenceFromSimilarity(similarity: number) {
  if (!Number.isFinite(similarity)) return 0
  return Math.max(0, Math.min(1, similarity))
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
  const limited = await rateLimit(`biometric-verify:${id}:${getClientIp(request)}`, 60, 60 * 60 * 1000)
  if (!limited.success) return rateLimitExceededResponse(limited.retryAfter)

  try {
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: "ID do colaborador invalido." }, { status: 400 })
    }

    const body = await readJsonWithLimit<Record<string, unknown>>(request, 64 * 1024)
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

    const storedDescriptor = await loadEmployeeReferenceEmbedding(id, companyIdScope)
    if (!storedDescriptor?.length) {
      return NextResponse.json({ match: false, confidence: 0 })
    }

    const similarity = cosineSimilarity(descriptor, storedDescriptor)
    const match = similarity >= FACE_MATCH_THRESHOLD

    return NextResponse.json({
      match,
      confidence: confidenceFromSimilarity(similarity),
    })
  } catch (error) {
    if (error instanceof RequestTooLargeError) {
      return NextResponse.json({ error: error.message }, { status: 413 })
    }
    console.error("[biometric-verify] unexpected error:", error)
    return NextResponse.json({ error: "Erro interno do servidor." }, { status: 500 })
  }
}
