import crypto from "crypto"
import { NextRequest, NextResponse } from "next/server"
import { requireAuthorizedUser } from "@/lib/serverAuth"
import { supabaseAdmin } from "@/lib/supabaseAdmin"

export async function POST(request: NextRequest) {
  const auth = await requireAuthorizedUser(request)
  if (!auth.authorized) {
    return auth.response
  }

  try {
    const body = await request.json()
    const { employee_id, type, data, expires_hours = 24 } = body

    if (!employee_id || !type) {
      return NextResponse.json({ error: "employee_id e type são obrigatórios" }, { status: 400 })
    }

    const dbType = type === "training_signature" ? "delivery" : type
    const linkData = type === "training_signature"
      ? { ...(data || {}), remoteType: "training_signature" }
      : data || null

    if (type !== "training_signature") {
      await supabaseAdmin
        .from("remote_links")
        .update({ status: "expired" })
        .eq("employee_id", employee_id)
        .eq("type", dbType)
        .eq("status", "pending")
    }

    const token = crypto.randomBytes(32).toString("hex")
    const expires_at = new Date(Date.now() + expires_hours * 60 * 60 * 1000).toISOString()

    const { data: link, error } = await supabaseAdmin
      .from("remote_links")
      .insert({
        employee_id,
        type: dbType,
        token,
        status: "pending",
        data: linkData,
        expires_at,
      })
      .select()
      .single()

    if (error) {
      console.error("[remote-links] Create error:", error)
      return NextResponse.json({ error: error.message, details: error }, { status: 500 })
    }

    return NextResponse.json({ link })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Erro interno"
    console.error("[remote-links] Unexpected error:", err)
    return NextResponse.json({ error: "Erro interno", message }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const token = searchParams.get("token")
    const includeCompleted = searchParams.get("include_completed") === "1"

    if (!token) {
      return NextResponse.json({ error: "Token não informado" }, { status: 400 })
    }

    const { data: link, error } = await supabaseAdmin
      .from("remote_links")
      .select("*, employee:employees(id, full_name, cpf, photo_url, face_descriptor, job_title, department, workplace_id)")
      .eq("token", token)
      .single()

    if (error || !link) {
      return NextResponse.json({ error: "Link não encontrado ou inválido.", status: "invalid" }, { status: 404 })
    }

    if (link.status === "completed" && includeCompleted) {
      return NextResponse.json({ link })
    }

    if (new Date(link.expires_at) < new Date()) {
      await supabaseAdmin
        .from("remote_links")
        .update({ status: "expired" })
        .eq("id", link.id)

      return NextResponse.json({ error: "Este link expirou. Solicite um novo link ao responsável.", status: "expired" }, { status: 410 })
    }

    if (link.status === "completed" && !includeCompleted) {
      return NextResponse.json({ error: "Este link já foi utilizado.", status: "completed" }, { status: 410 })
    }

    if (link.status === "expired") {
      return NextResponse.json({ error: "Este link expirou. Solicite um novo link ao responsável.", status: "expired" }, { status: 410 })
    }

    return NextResponse.json({ link })
  } catch (err) {
    console.error("[remote-links] GET error:", err)
    return NextResponse.json({ error: "Erro interno" }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireAuthorizedUser(request)
  if (!auth.authorized) {
    return auth.response
  }

  try {
    const body = await request.json()
    const { token } = body

    if (!token) {
      return NextResponse.json({ error: "Token não informado" }, { status: 400 })
    }

    const { data: link, error } = await supabaseAdmin
      .from("remote_links")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("token", token)
      .eq("status", "pending")
      .select()
      .single()

    if (error || !link) {
      return NextResponse.json({ error: "Não foi possível completar o link." }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error("[remote-links] PUT error:", err)
    return NextResponse.json({ error: "Erro interno" }, { status: 500 })
  }
}
