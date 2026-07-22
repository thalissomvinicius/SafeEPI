import { NextResponse } from "next/server"
import { z } from "zod"

import { requireAuthorizedUser } from "@/lib/serverAuth"
import { resolveFingerprintCompanyId } from "@/lib/serverFingerprint"
import { supabaseAdmin } from "@/lib/supabaseAdmin"

const noStore = { "Cache-Control": "no-store, max-age=0" }

export async function GET(request: Request) {
  const auth = await requireAuthorizedUser(request, ["MASTER", "ADMIN", "ALMOXARIFE"])
  if (!auth.authorized) return auth.response

  const { searchParams } = new URL(request.url)
  const requested = searchParams.get("company_id")
  if (requested && !z.string().uuid().safeParse(requested).success) {
    return NextResponse.json({ error: "Empresa inválida." }, { status: 400 })
  }
  const companyId = resolveFingerprintCompanyId(auth.user, requested)
  if (!companyId) return NextResponse.json({ error: "Selecione a empresa." }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from("fingerprint_terminals")
    .select("id,name,device_description,app_version,active,last_seen_at,paired_at")
    .eq("company_id", companyId)
    .eq("active", true)
    .order("last_seen_at", { ascending: false })
  if (error) {
    console.error("[fingerprint/terminals] lookup failed", error.message)
    return NextResponse.json({ error: "Não foi possível carregar os terminais." }, { status: 500 })
  }

  const now = Date.now()
  const terminals = (data || []).map((terminal) => ({
    ...terminal,
    online: Boolean(terminal.last_seen_at && now - Date.parse(terminal.last_seen_at) <= 90_000),
  }))
  return NextResponse.json({ terminals }, { headers: noStore })
}

export async function DELETE(request: Request) {
  const auth = await requireAuthorizedUser(request, ["MASTER", "ADMIN"])
  if (!auth.authorized) return auth.response

  const { searchParams } = new URL(request.url)
  const terminalId = searchParams.get("id")
  const requested = searchParams.get("company_id")
  if (!terminalId || !z.string().uuid().safeParse(terminalId).success) {
    return NextResponse.json({ error: "Terminal inválido." }, { status: 400 })
  }
  if (requested && !z.string().uuid().safeParse(requested).success) {
    return NextResponse.json({ error: "Empresa inválida." }, { status: 400 })
  }
  const companyId = resolveFingerprintCompanyId(auth.user, requested)
  if (!companyId) return NextResponse.json({ error: "Selecione a empresa." }, { status: 400 })

  const now = new Date().toISOString()
  const { data, error } = await supabaseAdmin
    .from("fingerprint_terminals")
    .update({ active: false, revoked_at: now, token_hash: null })
    .eq("id", terminalId)
    .eq("company_id", companyId)
    .eq("active", true)
    .select("id")
    .maybeSingle()
  if (error || !data) return NextResponse.json({ error: "Terminal não encontrado." }, { status: 404 })

  await supabaseAdmin
    .from("fingerprint_commands")
    .update({ status: "cancelled", completed_at: now, error_code: "terminal_revoked" })
    .eq("terminal_id", terminalId)
    .in("status", ["queued", "processing"])

  return NextResponse.json({ ok: true })
}
