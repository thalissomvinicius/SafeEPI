import { NextResponse } from "next/server"
import { getClientIp } from "@/lib/getClientIp"
import { rateLimit, rateLimitExceededResponse } from "@/lib/rateLimit"
import { requireAuthorizedUser } from "@/lib/serverAuth"
import { supabaseAdmin } from "@/lib/supabaseAdmin"
import type { EmployeeBiometric } from "@/types/biometric"

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TOKEN_REGEX = /^[0-9a-f]{64}$/i

type BiometricAccess =
  | { ok: true; companyIdScope: string | null }
  | { ok: false; response: NextResponse }

export function isValidBiometricUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_REGEX.test(value)
}

export function isValidRemoteToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_REGEX.test(value)
}

export async function callBiometricService<T>(path: string, formData: FormData): Promise<T> {
  const serviceUrl = process.env.BIOMETRIC_SERVICE_URL?.replace(/\/$/, "")
  const serviceToken = process.env.BIOMETRIC_SERVICE_TOKEN

  if (!serviceUrl || !serviceToken) {
    const error = new Error("Servico biometrico nao configurado. Usando evidencia facial local.")
    error.name = "BIOMETRIC_SERVICE_NOT_CONFIGURED"
    throw error
  }

  const response = await fetch(`${serviceUrl}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceToken}`,
    },
    body: formData,
    cache: "no-store",
  })

  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const detail = payload?.detail || payload?.error || "Servico biometrico indisponivel."
    throw new Error(typeof detail === "string" ? detail : "Servico biometrico indisponivel.")
  }

  return payload as T
}

async function validateRemoteBiometricToken(token: string, employeeId: string) {
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

export async function authorizeBiometricAccess(
  request: Request,
  employeeId: string | null,
  token: string | null,
): Promise<BiometricAccess> {
  if (employeeId && isValidRemoteToken(token)) {
    const remote = await validateRemoteBiometricToken(token, employeeId)
    if (!remote.ok) {
      return {
        ok: false,
        response: NextResponse.json({ error: remote.error }, { status: remote.status }),
      }
    }

    return { ok: true, companyIdScope: remote.companyId }
  }

  const auth = await requireAuthorizedUser(request)
  if (!auth.authorized) return { ok: false, response: auth.response }

  return {
    ok: true,
    companyIdScope: auth.user.role === "MASTER" ? null : auth.user.company_id,
  }
}

export function enforceBiometricRateLimit(request: Request, key: string) {
  const limited = rateLimit(`biometric:${key}:${getClientIp(request)}`, 90, 60 * 60 * 1000)
  if (!limited.success) return rateLimitExceededResponse(limited.retryAfter)
  return null
}

export async function loadEmployeeReferenceEmbedding(
  employeeId: string,
  companyIdScope: string | null,
): Promise<number[] | null> {
  let query = supabaseAdmin
    .from("employees")
    .select("id, company_id, face_descriptor")
    .eq("id", employeeId)

  if (companyIdScope) query = query.eq("company_id", companyIdScope)

  const { data, error } = await query.maybeSingle<EmployeeBiometric>()
  if (error) {
    console.error("[biometric] employee reference lookup failed:", error)
    throw new Error("Falha ao carregar referencia biometrica.")
  }

  return data?.face_descriptor?.length ? data.face_descriptor : null
}
