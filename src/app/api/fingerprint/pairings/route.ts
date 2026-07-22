import { NextResponse } from "next/server"
import { z } from "zod"

import {
  generateFingerprintPairingCode,
  hashFingerprintSecret,
} from "@/lib/fingerprintSecurity"
import { readJsonWithLimit, RequestTooLargeError } from "@/lib/requestSecurity"
import { requireAuthorizedUser } from "@/lib/serverAuth"
import { resolveFingerprintCompanyId } from "@/lib/serverFingerprint"
import { supabaseAdmin } from "@/lib/supabaseAdmin"

const pairingSchema = z.object({
  company_id: z.string().uuid().nullable().optional(),
  terminal_name: z.string().trim().min(2).max(80),
})

export async function POST(request: Request) {
  const auth = await requireAuthorizedUser(request, ["MASTER", "ADMIN"])
  if (!auth.authorized) return auth.response

  try {
    const parsed = pairingSchema.safeParse(await readJsonWithLimit(request, 4 * 1024))
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados de pareamento inválidos." }, { status: 400 })
    }

    const companyId = resolveFingerprintCompanyId(auth.user, parsed.data.company_id)
    if (!companyId) {
      return NextResponse.json({ error: "Selecione a empresa do terminal." }, { status: 400 })
    }

    const { data: company } = await supabaseAdmin
      .from("companies")
      .select("id,active")
      .eq("id", companyId)
      .eq("active", true)
      .maybeSingle()
    if (!company) return NextResponse.json({ error: "Empresa não encontrada." }, { status: 404 })

    const code = generateFingerprintPairingCode()
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()
    const { data, error } = await supabaseAdmin
      .from("fingerprint_pairings")
      .insert({
        company_id: companyId,
        code_hash: hashFingerprintSecret(code),
        terminal_name: parsed.data.terminal_name,
        expires_at: expiresAt,
        created_by: auth.user.id,
      })
      .select("id")
      .single()

    if (error || !data) {
      console.error("[fingerprint/pairings] insert failed", error?.message)
      return NextResponse.json({ error: "Não foi possível criar o pareamento." }, { status: 500 })
    }

    const displayCode = `${code.slice(0, 3)}-${code.slice(3, 6)}-${code.slice(6)}`
    return NextResponse.json({ pairing_id: data.id, code: displayCode, expires_at: expiresAt })
  } catch (error) {
    if (error instanceof RequestTooLargeError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("[fingerprint/pairings] unexpected error", error)
    return NextResponse.json({ error: "Erro interno ao criar pareamento." }, { status: 500 })
  }
}
