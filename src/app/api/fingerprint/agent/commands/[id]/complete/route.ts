import { NextResponse } from "next/server"
import { z } from "zod"

import { fingerprintEvidenceCode } from "@/lib/fingerprintSecurity"
import { readJsonWithLimit, RequestTooLargeError } from "@/lib/requestSecurity"
import {
  buildFingerprintResultHash,
  requireFingerprintTerminal,
  touchFingerprintTerminal,
} from "@/lib/serverFingerprint"
import { supabaseAdmin } from "@/lib/supabaseAdmin"

const resultSchema = z.object({
  success: z.boolean(),
  matched_employee_id: z.string().uuid().nullable().optional(),
  unit_id: z.number().int().min(0).max(10000).nullable().optional(),
  error_code: z.string().trim().min(1).max(80).nullable().optional(),
  reject_detail: z.number().int().min(0).max(10000).nullable().optional(),
})

type Context = { params: Promise<{ id: string }> }

export async function POST(request: Request, context: Context) {
  const auth = await requireFingerprintTerminal(request)
  if (!auth.authorized) return auth.response
  const { id } = await context.params
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Comando inválido." }, { status: 400 })

  try {
    const parsed = resultSchema.safeParse(await readJsonWithLimit(request, 8 * 1024))
    if (!parsed.success) return NextResponse.json({ error: "Resultado inválido." }, { status: 400 })

    const { data: command } = await supabaseAdmin
      .from("fingerprint_commands")
      .select("id,company_id,terminal_id,employee_id,operation,status,expires_at")
      .eq("id", id)
      .eq("terminal_id", auth.terminal.id)
      .eq("company_id", auth.terminal.company_id)
      .maybeSingle()
    if (!command) return NextResponse.json({ error: "Comando não encontrado." }, { status: 404 })
    if (command.status !== "processing") return NextResponse.json({ error: "Comando não está em processamento." }, { status: 409 })

    const completedAt = new Date().toISOString()
    if (Date.parse(command.expires_at) <= Date.now()) {
      await supabaseAdmin
        .from("fingerprint_commands")
        .update({ status: "expired", completed_at: completedAt, error_code: "expired" })
        .eq("id", id)
        .eq("status", "processing")
      return NextResponse.json({ error: "Comando expirado." }, { status: 410 })
    }

    const matchedEmployeeId = parsed.data.matched_employee_id || null
    const identityMatches = command.operation !== "verify" || matchedEmployeeId === command.employee_id
    const success = parsed.data.success && identityMatches
    const status = success ? "completed" : "failed"
    const errorCode = success
      ? null
      : !identityMatches
        ? "employee_mismatch"
        : parsed.data.error_code || "biometric_failed"
    const resultHash = buildFingerprintResultHash({
      commandId: command.id,
      companyId: command.company_id,
      terminalId: command.terminal_id,
      employeeId: command.employee_id,
      matchedEmployeeId,
      operation: command.operation,
      success,
      completedAt,
      unitId: parsed.data.unit_id || null,
      errorCode,
    })

    if (success && command.operation === "enroll") {
      const { error: enrollmentError } = await supabaseAdmin.from("fingerprint_enrollments").upsert({
        company_id: command.company_id,
        terminal_id: command.terminal_id,
        employee_id: command.employee_id,
        sub_factor: 2,
        active: true,
        enrolled_at: completedAt,
        removed_at: null,
        last_command_id: command.id,
      }, { onConflict: "terminal_id,employee_id" })
      if (enrollmentError) {
        console.error("[fingerprint/agent/commands/complete] enrollment sync failed", enrollmentError.message)
        return NextResponse.json({ error: "Não foi possível sincronizar o cadastro digital." }, { status: 500 })
      }
    } else if (success && command.operation === "delete") {
      const { error: enrollmentError } = await supabaseAdmin
        .from("fingerprint_enrollments")
        .update({ active: false, removed_at: completedAt, last_command_id: command.id })
        .eq("terminal_id", command.terminal_id)
        .eq("employee_id", command.employee_id)
      if (enrollmentError) {
        console.error("[fingerprint/agent/commands/complete] enrollment removal sync failed", enrollmentError.message)
        return NextResponse.json({ error: "Não foi possível sincronizar a remoção digital." }, { status: 500 })
      }
    } else if (success && command.operation === "verify") {
      const { error: enrollmentError } = await supabaseAdmin
        .from("fingerprint_enrollments")
        .update({ last_verified_at: completedAt, last_command_id: command.id })
        .eq("terminal_id", command.terminal_id)
        .eq("employee_id", command.employee_id)
        .eq("active", true)
      if (enrollmentError) {
        console.error("[fingerprint/agent/commands/complete] verification sync failed", enrollmentError.message)
        return NextResponse.json({ error: "Não foi possível sincronizar a confirmação digital." }, { status: 500 })
      }
    }

    const { data: updated, error } = await supabaseAdmin
      .from("fingerprint_commands")
      .update({
        status,
        success,
        completed_at: completedAt,
        matched_employee_id: matchedEmployeeId,
        unit_id: parsed.data.unit_id || null,
        error_code: errorCode,
        reject_detail: parsed.data.reject_detail || null,
        result_hash: resultHash,
        agent_metadata: {
          appVersion: auth.terminal.app_version,
          osVersion: auth.terminal.os_version,
          deviceInstanceHash: auth.terminal.device_instance_hash,
        },
      })
      .eq("id", command.id)
      .eq("status", "processing")
      .select("id")
      .maybeSingle()
    if (error || !updated) return NextResponse.json({ error: "Não foi possível registrar o resultado." }, { status: 409 })

    await touchFingerprintTerminal(auth.terminal.id)
    return NextResponse.json({ ok: success, status, evidence_code: fingerprintEvidenceCode(command.id) })
  } catch (error) {
    if (error instanceof RequestTooLargeError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("[fingerprint/agent/commands/complete] unexpected error", error)
    return NextResponse.json({ error: "Erro interno ao registrar resultado." }, { status: 500 })
  }
}
