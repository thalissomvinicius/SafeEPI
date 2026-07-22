import "server-only"

import { createHash } from "node:crypto"
import { NextResponse } from "next/server"

import {
  extractFingerprintBearer,
  fingerprintEvidenceCode,
  hashFingerprintSecret,
} from "@/lib/fingerprintSecurity"
import { supabaseAdmin } from "@/lib/supabaseAdmin"

type AuthorizedUserLike = {
  id: string
  role: string
  company_id: string | null
}

export type FingerprintTerminal = {
  id: string
  company_id: string
  name: string
  device_id: string
  token_hash: string
  device_instance_hash: string | null
  device_description: string | null
  app_version: string | null
  os_version: string | null
  active: boolean
  last_seen_at: string | null
}

type TerminalAuthResult =
  | { authorized: true; terminal: FingerprintTerminal }
  | { authorized: false; response: NextResponse }

export function normalizeFingerprintPairingCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 9)
}

export function hashFingerprintDeviceInstance(value: string | null | undefined): string | null {
  const normalized = value?.trim()
  if (!normalized) return null
  return createHash("sha256").update(normalized, "utf8").digest("hex")
}

export function buildFingerprintResultHash(input: Record<string, unknown>): string {
  const canonical = Object.keys(input)
    .sort()
    .map((key) => `${key}:${JSON.stringify(input[key])}`)
    .join("|")
  return createHash("sha256").update(canonical, "utf8").digest("hex")
}

export function resolveFingerprintCompanyId(
  user: AuthorizedUserLike,
  requestedCompanyId: string | null | undefined,
): string | null {
  if (user.role === "MASTER") return requestedCompanyId || null
  return user.company_id
}

export async function requireFingerprintTerminal(request: Request): Promise<TerminalAuthResult> {
  const token = extractFingerprintBearer(request.headers.get("authorization"))
  if (!token || token.length < 32 || token.length > 200) {
    return {
      authorized: false,
      response: NextResponse.json({ error: "Credencial do terminal ausente." }, { status: 401 }),
    }
  }

  const tokenHash = hashFingerprintSecret(token)
  const { data, error } = await supabaseAdmin
    .from("fingerprint_terminals")
    .select("id,company_id,name,device_id,token_hash,device_instance_hash,device_description,app_version,os_version,active,last_seen_at")
    .eq("token_hash", tokenHash)
    .eq("active", true)
    .maybeSingle<FingerprintTerminal>()

  if (error || !data) {
    return {
      authorized: false,
      response: NextResponse.json({ error: "Terminal não autorizado." }, { status: 401 }),
    }
  }

  return { authorized: true, terminal: data }
}

export async function touchFingerprintTerminal(terminalId: string) {
  await supabaseAdmin
    .from("fingerprint_terminals")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", terminalId)
}

export async function findCompanyEmployee(companyId: string, employeeId: string) {
  const { data, error } = await supabaseAdmin
    .from("employees")
    .select("id,company_id,full_name,cpf,active")
    .eq("id", employeeId)
    .eq("company_id", companyId)
    .eq("active", true)
    .maybeSingle()
  if (error) throw error
  return data as { id: string; company_id: string; full_name: string; cpf: string | null; active: boolean } | null
}

export function serializeFingerprintCommand(command: {
  id: string
  operation: string
  employee_id: string
  expires_at: string
  employee?: { full_name?: string | null } | null
}) {
  return {
    id: command.id,
    operation: command.operation,
    employee_id: command.employee_id,
    employee_name: command.employee?.full_name || "COLABORADOR SAFEEPI",
    expires_at: command.expires_at,
  }
}

export function serializeFingerprintEvidence(command: {
  id: string
  status: string
  operation: string
  employee_id: string
  matched_employee_id?: string | null
  completed_at?: string | null
  expires_at: string
  result_hash?: string | null
  terminal?: { name?: string | null } | null
}) {
  return {
    id: command.id,
    code: fingerprintEvidenceCode(command.id),
    status: command.status,
    operation: command.operation,
    employeeId: command.employee_id,
    matchedEmployeeId: command.matched_employee_id || null,
    completedAt: command.completed_at || null,
    expiresAt: command.expires_at,
    resultHash: command.result_hash || null,
    terminalName: command.terminal?.name || null,
  }
}
