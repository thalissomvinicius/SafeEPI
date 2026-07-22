import { NextResponse } from "next/server"

import {
  requireFingerprintTerminal,
  serializeFingerprintCommand,
  touchFingerprintTerminal,
} from "@/lib/serverFingerprint"
import { supabaseAdmin } from "@/lib/supabaseAdmin"

const noStore = { "Cache-Control": "no-store, max-age=0" }

export async function GET(request: Request) {
  const auth = await requireFingerprintTerminal(request)
  if (!auth.authorized) return auth.response
  const terminal = auth.terminal
  const now = new Date()

  await Promise.all([
    touchFingerprintTerminal(terminal.id),
    supabaseAdmin
      .from("fingerprint_commands")
      .update({ status: "expired", completed_at: now.toISOString(), error_code: "expired" })
      .eq("terminal_id", terminal.id)
      .in("status", ["queued", "processing"])
      .lte("expires_at", now.toISOString()),
    supabaseAdmin
      .from("fingerprint_commands")
      .update({ status: "queued", processing_started_at: null, error_code: "agent_reclaimed" })
      .eq("terminal_id", terminal.id)
      .eq("status", "processing")
      .lt("processing_started_at", new Date(now.getTime() - 90_000).toISOString())
      .gt("expires_at", now.toISOString()),
  ])

  const { data: queued, error } = await supabaseAdmin
    .from("fingerprint_commands")
    .select("id,operation,employee_id,expires_at,employee:employees(full_name)")
    .eq("terminal_id", terminal.id)
    .eq("company_id", terminal.company_id)
    .eq("status", "queued")
    .gt("expires_at", now.toISOString())
    .order("requested_at", { ascending: true })
    .limit(1)
  if (error) {
    console.error("[fingerprint/agent/commands] lookup failed", error.message)
    return NextResponse.json({ error: "Falha ao consultar comandos." }, { status: 500 })
  }
  const candidate = queued?.[0]
  if (!candidate) return NextResponse.json({ command: null }, { headers: noStore })

  const { data: claimed } = await supabaseAdmin
    .from("fingerprint_commands")
    .update({ status: "processing", processing_started_at: now.toISOString(), error_code: null })
    .eq("id", candidate.id)
    .eq("terminal_id", terminal.id)
    .eq("status", "queued")
    .select("id")
    .maybeSingle()
  if (!claimed) return NextResponse.json({ command: null }, { headers: noStore })

  const employee = Array.isArray(candidate.employee) ? candidate.employee[0] : candidate.employee
  return NextResponse.json({ command: serializeFingerprintCommand({ ...candidate, employee }) }, { headers: noStore })
}
