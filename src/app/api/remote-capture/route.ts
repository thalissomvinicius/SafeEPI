import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabaseAdmin"

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_REGEX.test(value)
}

function isValidToken(value: unknown): value is string {
  // Tokens gerados por crypto.randomBytes(32).toString("hex") = 64 hex chars.
  return typeof value === "string" && /^[0-9a-f]{64}$/i.test(value)
}

/**
 * Valida o link remoto e retorna o registro se válido.
 * Critérios: token existe, type bate, não expirado, status pending,
 * employee_id bate com o solicitado.
 */
async function loadValidLink(token: string, expectedEmployeeId: string, expectedType: string) {
  const { data: link } = await supabaseAdmin
    .from("remote_links")
    .select("id, employee_id, type, status, expires_at, data")
    .eq("token", token)
    .maybeSingle()

  if (!link) return { ok: false as const, status: 404, error: "Link não encontrado." }
  if (link.employee_id !== expectedEmployeeId) {
    return { ok: false as const, status: 403, error: "Link não corresponde ao colaborador." }
  }

  const linkType = link.type === "delivery" && link.data?.remoteType
    ? link.data.remoteType
    : link.type

  if (linkType !== expectedType) {
    return { ok: false as const, status: 403, error: "Tipo de link incompatível." }
  }
  if (new Date(link.expires_at) < new Date()) {
    await supabaseAdmin.from("remote_links").update({ status: "expired" }).eq("id", link.id)
    return { ok: false as const, status: 410, error: "Este link expirou." }
  }
  if (link.status !== "pending") {
    return { ok: false as const, status: 410, error: "Este link já foi utilizado." }
  }

  return { ok: true as const, link }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get("id")
    const token = searchParams.get("token")

    if (!isValidUuid(id)) {
      return NextResponse.json({ error: "ID do colaborador inválido." }, { status: 400 })
    }
    // Token agora é OBRIGATÓRIO em GET — antes qualquer um podia enumerar PII.
    if (!isValidToken(token)) {
      return NextResponse.json({ error: "Token inválido." }, { status: 401 })
    }

    const validation = await loadValidLink(token, id, "capture")
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: validation.status })
    }

    const { data: employee, error } = await supabaseAdmin
      .from("employees")
      .select("id, full_name, photo_url")
      .eq("id", id)
      .maybeSingle()

    if (error || !employee) {
      return NextResponse.json({ error: "Colaborador não encontrado." }, { status: 404 })
    }

    // CPF NÃO é mais retornado no fluxo público — apenas o necessário para
    // exibir nome e foto no formulário de captura.
    return NextResponse.json(employee)
  } catch (error: unknown) {
    console.error("[/api/remote-capture][GET] error:", error)
    return NextResponse.json({ error: "Erro interno do servidor." }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { id, photo_url, face_descriptor, token } = body

    if (!isValidUuid(id)) {
      return NextResponse.json({ error: "ID do colaborador inválido." }, { status: 400 })
    }
    if (typeof photo_url !== "string" || !photo_url.trim()) {
      return NextResponse.json({ error: "URL da foto é obrigatória." }, { status: 400 })
    }
    if (!Array.isArray(face_descriptor) || face_descriptor.length === 0) {
      return NextResponse.json({ error: "Descritor facial é obrigatório." }, { status: 400 })
    }
    // Token agora é OBRIGATÓRIO — não há mais fallback "sem token".
    if (!isValidToken(token)) {
      return NextResponse.json({ error: "Token inválido." }, { status: 401 })
    }

    const validation = await loadValidLink(token, id, "capture")
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: validation.status })
    }

    // Atomic: marca como completed APENAS se ainda for pending.
    const { data: claimed, error: claimError } = await supabaseAdmin
      .from("remote_links")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", validation.link.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle()

    if (claimError || !claimed) {
      return NextResponse.json({ error: "Link já consumido por outra requisição." }, { status: 409 })
    }

    const { data, error } = await supabaseAdmin
      .from("employees")
      .update({ photo_url, face_descriptor })
      .eq("id", id)
      .select()
      .single()

    if (error) {
      console.error("[/api/remote-capture][POST] update error:", error)
      return NextResponse.json({ error: "Falha ao atualizar dados." }, { status: 500 })
    }

    return NextResponse.json({ success: true, employee: data })
  } catch (error: unknown) {
    console.error("[/api/remote-capture][POST] error:", error)
    return NextResponse.json({ error: "Erro interno do servidor." }, { status: 500 })
  }
}
