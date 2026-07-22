import { NextResponse } from "next/server"
import { z } from "zod"

import { requireAuthorizedUser } from "@/lib/serverAuth"
import { resolveFingerprintCompanyId, serializeFingerprintEvidence } from "@/lib/serverFingerprint"
import { supabaseAdmin } from "@/lib/supabaseAdmin"

const noStore = { "Cache-Control": "no-store, max-age=0" }

type Context = { params: Promise<{ id: string }> }

export async function GET(request: Request, context: Context) {
  const auth = await requireAuthorizedUser(request, ["MASTER", "ADMIN", "ALMOXARIFE"])
  if (!auth.authorized) return auth.response

  const { id } = await context.params
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Comando inválido." }, { status: 400 })
  const requestedCompanyId = new URL(request.url).searchParams.get("company_id")
  if (requestedCompanyId && !z.string().uuid().safeParse(requestedCompanyId).success) {
    return NextResponse.json({ error: "Empresa inválida." }, { status: 400 })
  }
  const companyId = resolveFingerprintCompanyId(auth.user, requestedCompanyId)
  if (!companyId) return NextResponse.json({ error: "Selecione a empresa." }, { status: 400 })

  const { data: command, error } = await supabaseAdmin
    .from("fingerprint_commands")
    .select("id,status,operation,employee_id,matched_employee_id,completed_at,expires_at,result_hash,error_code,terminal:fingerprint_terminals(name)")
    .eq("id", id)
    .eq("company_id", companyId)
    .maybeSingle()
  if (error) return NextResponse.json({ error: "Falha ao consultar leitura." }, { status: 500 })
  if (!command) return NextResponse.json({ error: "Leitura não encontrada." }, { status: 404 })

  if (["queued", "processing"].includes(command.status) && Date.parse(command.expires_at) <= Date.now()) {
    await supabaseAdmin
      .from("fingerprint_commands")
      .update({ status: "expired", completed_at: new Date().toISOString(), error_code: "expired" })
      .eq("id", id)
      .in("status", ["queued", "processing"])
    command.status = "expired"
    command.error_code = "expired"
  }

  return NextResponse.json({
    command: {
      ...serializeFingerprintEvidence({
        ...command,
        terminal: Array.isArray(command.terminal) ? command.terminal[0] || null : command.terminal,
      }),
      errorCode: command.error_code || null,
    },
  }, { headers: noStore })
}
