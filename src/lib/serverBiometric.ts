import { NextResponse } from "next/server"
import { getClientIp } from "@/lib/getClientIp"
import { rateLimit, rateLimitExceededResponse } from "@/lib/rateLimit"
import { requireAuthorizedUser } from "@/lib/serverAuth"
import { supabaseAdmin } from "@/lib/supabaseAdmin"
import type { EmployeeBiometric } from "@/types/biometric"
import {
  BIOMETRIC_KEY_VERSION,
  decryptBiometricDescriptor,
  encryptBiometricDescriptor,
} from "@/lib/biometricEncryption"

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

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  let response: Response
  try {
    response = await fetch(`${serviceUrl}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceToken}`,
      },
      body: formData,
      cache: "no-store",
      signal: controller.signal,
    })
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Servico biometrico excedeu o tempo limite.")
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }

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

export async function enforceBiometricRateLimit(request: Request, key: string) {
  const limited = await rateLimit(`biometric:${key}:${getClientIp(request)}`, 90, 60 * 60 * 1000)
  if (!limited.success) return rateLimitExceededResponse(limited.retryAfter)
  return null
}

export async function loadEmployeeReferenceEmbedding(
  employeeId: string,
  companyIdScope: string | null,
): Promise<number[] | null> {
  let query = supabaseAdmin
    .from("employees")
    .select("id, company_id, face_descriptor, face_descriptor_encrypted, biometric_key_version")
    .eq("id", employeeId)

  if (companyIdScope) query = query.eq("company_id", companyIdScope)

  const { data, error } = await query.maybeSingle<EmployeeBiometric & {
    company_id: string
    face_descriptor_encrypted?: string | null
    biometric_key_version?: string | null
  }>()
  if (error) {
    console.error("[biometric] employee reference lookup failed:", error)
    throw new Error("Falha ao carregar referencia biometrica.")
  }

  if (!data) return null

  if (data.face_descriptor_encrypted) {
    try {
      return decryptBiometricDescriptor(data.face_descriptor_encrypted, data.company_id)
    } catch (decryptionError) {
      console.error("[biometric] encrypted descriptor could not be decrypted:", {
        employeeId: data.id,
        keyVersion: data.biometric_key_version,
        error: decryptionError instanceof Error ? decryptionError.message : "unknown",
      })
      throw new Error("Referencia biometrica indisponivel.")
    }
  }

  if (!data.face_descriptor?.length) return null

  const encrypted = encryptBiometricDescriptor(data.face_descriptor, data.company_id)
  const { error: migrationError } = await supabaseAdmin
    .from("employees")
    .update({
      face_descriptor_encrypted: encrypted,
      biometric_key_version: BIOMETRIC_KEY_VERSION,
      face_descriptor: null,
    })
    .eq("id", data.id)
    .eq("company_id", data.company_id)

  if (migrationError) {
    console.error("[biometric] legacy descriptor migration failed:", migrationError)
    throw new Error("Falha ao proteger referencia biometrica legada.")
  }

  return data.face_descriptor
}
