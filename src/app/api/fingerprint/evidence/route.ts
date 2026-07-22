import { NextResponse } from "next/server"
import { z } from "zod"

import { requireAuthorizedUser } from "@/lib/serverAuth"
import { resolveFingerprintCompanyId, serializeFingerprintEvidence } from "@/lib/serverFingerprint"
import { supabaseAdmin } from "@/lib/supabaseAdmin"

const noStore = { "Cache-Control": "no-store, max-age=0" }

export async function GET(request: Request) {
  const auth = await requireAuthorizedUser(request, ["MASTER", "ADMIN", "ALMOXARIFE", "DIRETORIA"])
  if (!auth.authorized) return auth.response

  const { searchParams } = new URL(request.url)
  const deliveryId = searchParams.get("delivery_id")
  const requestedCompanyId = searchParams.get("company_id")
  if (!deliveryId || !z.string().uuid().safeParse(deliveryId).success) {
    return NextResponse.json({ error: "Entrega inválida." }, { status: 400 })
  }
  if (requestedCompanyId && !z.string().uuid().safeParse(requestedCompanyId).success) {
    return NextResponse.json({ error: "Empresa inválida." }, { status: 400 })
  }
  const companyId = resolveFingerprintCompanyId(auth.user, requestedCompanyId)
  if (!companyId) return NextResponse.json({ error: "Selecione a empresa." }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from("fingerprint_delivery_links")
    .select("batch_id,command:fingerprint_commands(id,status,operation,employee_id,matched_employee_id,completed_at,expires_at,result_hash,terminal:fingerprint_terminals(name))")
    .eq("company_id", companyId)
    .eq("delivery_id", deliveryId)
    .maybeSingle()
  if (error) return NextResponse.json({ error: "Falha ao consultar a evidência biométrica." }, { status: 500 })
  if (!data) return NextResponse.json({ error: "Evidência biométrica não encontrada." }, { status: 404 })

  const commandRelation = Array.isArray(data.command) ? data.command[0] : data.command
  if (!commandRelation) return NextResponse.json({ error: "Evento biométrico não encontrado." }, { status: 404 })
  const terminal = Array.isArray(commandRelation.terminal) ? commandRelation.terminal[0] : commandRelation.terminal

  return NextResponse.json({
    evidence: serializeFingerprintEvidence({ ...commandRelation, terminal }),
    batchId: data.batch_id,
  }, { headers: noStore })
}
