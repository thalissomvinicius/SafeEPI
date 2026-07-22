import { NextResponse } from "next/server"
import { z } from "zod"

import { getClientIp } from "@/lib/getClientIp"
import {
  generateFingerprintTerminalToken,
  hashFingerprintSecret,
} from "@/lib/fingerprintSecurity"
import { rateLimit, rateLimitExceededResponse } from "@/lib/rateLimit"
import { readJsonWithLimit, RequestTooLargeError } from "@/lib/requestSecurity"
import {
  hashFingerprintDeviceInstance,
  normalizeFingerprintPairingCode,
} from "@/lib/serverFingerprint"
import { supabaseAdmin } from "@/lib/supabaseAdmin"

const pairSchema = z.object({
  code: z.string().min(9).max(20),
  device_id: z.string().uuid(),
  device_instance_id: z.string().trim().max(512).nullable().optional(),
  device_description: z.string().trim().max(180).nullable().optional(),
  app_version: z.string().trim().min(1).max(40),
  os_version: z.string().trim().min(1).max(120),
  current_company_id: z.string().uuid().nullable().optional(),
})

export async function POST(request: Request) {
  const limited = await rateLimit(`fingerprint:pair:${getClientIp(request)}`, 8, 15 * 60 * 1000)
  if (!limited.success) return rateLimitExceededResponse(limited.retryAfter)

  try {
    const parsed = pairSchema.safeParse(await readJsonWithLimit(request, 8 * 1024))
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados do terminal inválidos." }, { status: 400 })
    }

    const normalizedCode = normalizeFingerprintPairingCode(parsed.data.code)
    if (normalizedCode.length !== 9) {
      return NextResponse.json({ error: "Código de pareamento inválido." }, { status: 400 })
    }

    const now = new Date().toISOString()
    const { data: pairing } = await supabaseAdmin
      .from("fingerprint_pairings")
      .select("id,company_id,terminal_name,created_by,expires_at")
      .eq("code_hash", hashFingerprintSecret(normalizedCode))
      .is("used_at", null)
      .gt("expires_at", now)
      .maybeSingle()

    if (!pairing) {
      return NextResponse.json({ error: "Código inválido, expirado ou já utilizado." }, { status: 401 })
    }
    if (parsed.data.current_company_id && parsed.data.current_company_id !== pairing.company_id) {
      return NextResponse.json({ error: "Para trocar a empresa deste computador, remova e reinstale o SafeEPI Leitor primeiro." }, { status: 409 })
    }

    const deviceInstanceHash = hashFingerprintDeviceInstance(parsed.data.device_instance_id)
    let existingDeviceQuery = supabaseAdmin
      .from("fingerprint_terminals")
      .select("id")
      .eq("active", true)
      .neq("company_id", pairing.company_id)
    existingDeviceQuery = deviceInstanceHash
      ? existingDeviceQuery.or(`device_id.eq.${parsed.data.device_id},device_instance_hash.eq.${deviceInstanceHash}`)
      : existingDeviceQuery.eq("device_id", parsed.data.device_id)
    const { data: terminalInAnotherCompany } = await existingDeviceQuery.limit(1).maybeSingle()
    if (terminalInAnotherCompany) {
      return NextResponse.json({ error: "Este computador já está vinculado a outra empresa. Revogue o terminal anterior antes de continuar." }, { status: 409 })
    }

    const { data: consumed } = await supabaseAdmin
      .from("fingerprint_pairings")
      .update({ used_at: now })
      .eq("id", pairing.id)
      .is("used_at", null)
      .select("id")
      .maybeSingle()
    if (!consumed) {
      return NextResponse.json({ error: "Código já utilizado." }, { status: 409 })
    }

    const terminalToken = generateFingerprintTerminalToken()
    const terminalPayload = {
      company_id: pairing.company_id,
      name: pairing.terminal_name,
      device_id: parsed.data.device_id,
      token_hash: hashFingerprintSecret(terminalToken),
      device_instance_hash: deviceInstanceHash,
      device_description: parsed.data.device_description || null,
      app_version: parsed.data.app_version,
      os_version: parsed.data.os_version,
      active: true,
      last_seen_at: now,
      paired_by: pairing.created_by,
      revoked_at: null,
    }
    const { data: terminal, error } = await supabaseAdmin
      .from("fingerprint_terminals")
      .upsert(terminalPayload, { onConflict: "company_id,device_id" })
      .select("id,company_id,name")
      .single()

    if (error || !terminal) {
      console.error("[fingerprint/agent/pair] terminal upsert failed", error?.message)
      return NextResponse.json({ error: "Não foi possível registrar o terminal." }, { status: 500 })
    }

    return NextResponse.json({
      terminal_id: terminal.id,
      company_id: terminal.company_id,
      terminal_name: terminal.name,
      terminal_token: terminalToken,
      poll_interval_seconds: 2,
    })
  } catch (error) {
    if (error instanceof RequestTooLargeError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("[fingerprint/agent/pair] unexpected error", error)
    return NextResponse.json({ error: "Erro interno no pareamento." }, { status: 500 })
  }
}
