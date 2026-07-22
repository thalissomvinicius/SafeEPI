import { NextResponse } from "next/server"
import { z } from "zod"

import { readJsonWithLimit, RequestTooLargeError } from "@/lib/requestSecurity"
import { requireAuthorizedUser } from "@/lib/serverAuth"
import {
  findCompanyEmployee,
  resolveFingerprintCompanyId,
  serializeFingerprintEvidence,
} from "@/lib/serverFingerprint"
import { supabaseAdmin } from "@/lib/supabaseAdmin"

const commandSchema = z.object({
  company_id: z.string().uuid().nullable().optional(),
  terminal_id: z.string().uuid().optional(),
  employee_id: z.string().uuid(),
  operation: z.enum(["enroll", "verify", "delete"]),
})

export async function POST(request: Request) {
  const auth = await requireAuthorizedUser(request, ["MASTER", "ADMIN", "ALMOXARIFE"])
  if (!auth.authorized) return auth.response

  try {
    const parsed = commandSchema.safeParse(await readJsonWithLimit(request, 8 * 1024))
    if (!parsed.success) return NextResponse.json({ error: "Comando biométrico inválido." }, { status: 400 })
    if (parsed.data.operation !== "verify" && auth.user.role === "ALMOXARIFE") {
      return NextResponse.json({ error: "Apenas administradores podem alterar cadastros digitais." }, { status: 403 })
    }

    const companyId = resolveFingerprintCompanyId(auth.user, parsed.data.company_id)
    if (!companyId) return NextResponse.json({ error: "Selecione a empresa." }, { status: 400 })
    const employee = await findCompanyEmployee(companyId, parsed.data.employee_id)
    if (!employee) return NextResponse.json({ error: "Colaborador não encontrado na empresa." }, { status: 404 })

    const onlineCutoff = new Date(Date.now() - 90_000).toISOString()
    let terminalQuery = supabaseAdmin
      .from("fingerprint_terminals")
      .select("id,name,last_seen_at")
      .eq("company_id", companyId)
      .eq("active", true)
      .gte("last_seen_at", onlineCutoff)
    if (parsed.data.terminal_id) terminalQuery = terminalQuery.eq("id", parsed.data.terminal_id)
    const { data: terminals } = await terminalQuery.order("last_seen_at", { ascending: false }).limit(1)
    const terminal = terminals?.[0]
    if (!terminal) {
      return NextResponse.json({ error: "Aplicativo SafeEPI Leitor offline. Abra o aplicativo neste PC." }, { status: 409 })
    }

    if (parsed.data.operation === "verify" || parsed.data.operation === "enroll") {
      const { data: enrollment } = await supabaseAdmin
        .from("fingerprint_enrollments")
        .select("id")
        .eq("terminal_id", terminal.id)
        .eq("employee_id", employee.id)
        .eq("active", true)
        .maybeSingle()
      if (parsed.data.operation === "verify" && !enrollment) {
        return NextResponse.json({ error: "Este colaborador ainda não cadastrou a digital neste terminal." }, { status: 409 })
      }
      if (parsed.data.operation === "enroll" && enrollment) {
        return NextResponse.json({ error: "A digital deste colaborador já está cadastrada neste terminal." }, { status: 409 })
      }
    }

    await supabaseAdmin
      .from("fingerprint_commands")
      .update({ status: "cancelled", completed_at: new Date().toISOString(), error_code: "superseded" })
      .eq("terminal_id", terminal.id)
      .eq("employee_id", employee.id)
      .in("status", ["queued", "processing"])

    const expiresAt = new Date(Date.now() + 2 * 60 * 1000).toISOString()
    const { data: command, error } = await supabaseAdmin
      .from("fingerprint_commands")
      .insert({
        company_id: companyId,
        terminal_id: terminal.id,
        employee_id: employee.id,
        operation: parsed.data.operation,
        status: "queued",
        requested_by: auth.user.id,
        expires_at: expiresAt,
      })
      .select("id,status,operation,employee_id,matched_employee_id,completed_at,expires_at,result_hash")
      .single()
    if (error || !command) {
      console.error("[fingerprint/commands] insert failed", error?.message)
      return NextResponse.json({ error: "Não foi possível iniciar a leitura digital." }, { status: 500 })
    }

    return NextResponse.json({
      command: serializeFingerprintEvidence({ ...command, terminal: { name: terminal.name } }),
    })
  } catch (error) {
    if (error instanceof RequestTooLargeError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("[fingerprint/commands] unexpected error", error)
    return NextResponse.json({ error: "Erro interno ao iniciar leitura digital." }, { status: 500 })
  }
}
