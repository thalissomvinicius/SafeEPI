import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabaseAdmin"

const TOKEN_REGEX = /^[0-9a-f]{64}$/i

function isValidToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_REGEX.test(value)
}

const MAX_DATA_URL_BYTES = 3 * 1024 * 1024 // 3MB
const DATA_URL_PREFIX = /^data:image\/(png|jpe?g|webp);base64,/i

function isValidDataUrl(value: unknown): value is string {
  if (typeof value !== "string") return false
  if (!DATA_URL_PREFIX.test(value)) return false
  // Tamanho aproximado em bytes do payload base64.
  const approxBytes = (value.length - value.indexOf(",") - 1) * 0.75
  return approxBytes <= MAX_DATA_URL_BYTES
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { token, signatureBase64, authMethod = "manual", photoBase64 = null } = body

    if (!isValidToken(token)) {
      return NextResponse.json({ error: "Token inválido." }, { status: 401 })
    }
    if (!isValidDataUrl(signatureBase64)) {
      return NextResponse.json({ error: "Assinatura inválida ou muito grande." }, { status: 400 })
    }
    if (photoBase64 !== null && !isValidDataUrl(photoBase64)) {
      return NextResponse.json({ error: "Foto inválida ou muito grande." }, { status: 400 })
    }
    if (authMethod !== "manual" && authMethod !== "facial" && authMethod !== "manual_facial") {
      return NextResponse.json({ error: "Método de autenticação inválido." }, { status: 400 })
    }

    const { data: link, error: linkError } = await supabaseAdmin
      .from("remote_links")
      .select("id, status, expires_at, type, data")
      .eq("token", token)
      .maybeSingle()

    const isTrainingLink =
      link &&
      (link.type === "training_signature" ||
        link?.data?.remoteType === "training_signature")

    if (linkError || !link || !isTrainingLink) {
      return NextResponse.json({ error: "Link não encontrado ou inválido." }, { status: 404 })
    }

    if (new Date(link.expires_at) < new Date()) {
      await supabaseAdmin.from("remote_links").update({ status: "expired" }).eq("id", link.id)
      return NextResponse.json(
        { error: "Este link expirou.", status: "expired" },
        { status: 410 },
      )
    }

    if (link.status !== "pending") {
      return NextResponse.json(
        { error: "Este link já foi utilizado.", status: link.status },
        { status: 410 },
      )
    }

    const mergedData = {
      ...(link.data || {}),
      signatureBase64,
      photoBase64,
      authMethod,
      signedAt: new Date().toISOString(),
    }

    // Update atômico — só completa se ainda estiver pending.
    const { data: claimed, error: updateError } = await supabaseAdmin
      .from("remote_links")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        data: mergedData,
      })
      .eq("id", link.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle()

    if (updateError || !claimed) {
      return NextResponse.json({ error: "Link já consumido por outra requisição." }, { status: 409 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error("[/api/remote-training-signature] error:", err)
    return NextResponse.json({ error: "Erro interno." }, { status: 500 })
  }
}
