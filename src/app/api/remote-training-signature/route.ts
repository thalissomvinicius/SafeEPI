import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabaseAdmin"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { token, signatureBase64, authMethod = "manual", photoBase64 = null } = body

    if (!token || !signatureBase64) {
      return NextResponse.json({ error: "Token e assinatura sao obrigatorios." }, { status: 400 })
    }

    const { data: link, error: linkError } = await supabaseAdmin
      .from("remote_links")
      .select("*")
      .eq("token", token)
      .single()

    if (linkError || !link || (link.type !== "training_signature" && link.data?.remoteType !== "training_signature")) {
      return NextResponse.json({ error: "Link nao encontrado ou invalido." }, { status: 404 })
    }

    if (new Date(link.expires_at) < new Date()) {
      await supabaseAdmin.from("remote_links").update({ status: "expired" }).eq("id", link.id)
      return NextResponse.json({ error: "Este link expirou.", status: "expired" }, { status: 410 })
    }

    if (link.status !== "pending") {
      return NextResponse.json({ error: "Este link ja foi utilizado.", status: link.status }, { status: 410 })
    }

    const mergedData = {
      ...(link.data || {}),
      signatureBase64,
      photoBase64,
      authMethod,
      signedAt: new Date().toISOString(),
    }

    const { error: updateError } = await supabaseAdmin
      .from("remote_links")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        data: mergedData,
      })
      .eq("id", link.id)
      .eq("status", "pending")

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error("[remote-training-signature] POST error:", err)
    return NextResponse.json({ error: "Erro interno." }, { status: 500 })
  }
}
