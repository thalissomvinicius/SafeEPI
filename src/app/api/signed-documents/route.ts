import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabaseAdmin"

const VALID_DOCUMENT_TYPES = new Set([
  "delivery",
  "remote_delivery",
  "return",
  "nr06",
  "training_certificate",
])

function sanitizeFileName(fileName: string) {
  return fileName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_.-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 140) || "documento_assinado.pdf"
}

function parseJsonField<T>(value: FormDataEntryValue | null, fallback: T): T {
  if (typeof value !== "string" || !value.trim()) return fallback

  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function isMissingAuditTable(error: unknown) {
  if (!error || typeof error !== "object") return false
  const maybeError = error as { code?: string; message?: string; details?: string; hint?: string; status?: number }
  const text = `${maybeError.message || ""} ${maybeError.details || ""} ${maybeError.hint || ""}`.toLowerCase()

  return (
    maybeError.code === "42P01" ||
    maybeError.code === "PGRST205" ||
    maybeError.status === 404 ||
    text.includes("signed_documents") && (
      text.includes("schema cache") ||
      text.includes("does not exist") ||
      text.includes("could not find")
    )
  )
}

async function resolveUserId(request: Request) {
  const authHeader = request.headers.get("authorization")
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null
  if (!token) return null

  const { data, error } = await supabaseAdmin.auth.getUser(token)
  if (error || !data.user) return null
  return data.user.id
}

async function validateRemoteLink(linkToken: string | null, employeeId: string | null) {
  if (!linkToken) return false

  const { data: link } = await supabaseAdmin
    .from("remote_links")
    .select("employee_id,status,expires_at")
    .eq("token", linkToken)
    .maybeSingle()

  if (!link) return false
  if (employeeId && link.employee_id !== employeeId) return false
  if (new Date(link.expires_at) < new Date()) return false

  return link.status === "completed" || link.status === "pending"
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const pdfFile = formData.get("pdfFile")
    const documentType = String(formData.get("document_type") || "")
    const employeeId = String(formData.get("employee_id") || "") || null
    const linkToken = String(formData.get("link_token") || "") || null
    const createdBy = await resolveUserId(request)

    if (!pdfFile || !(pdfFile instanceof File) || pdfFile.size === 0) {
      return NextResponse.json({ error: "PDF assinado nao informado." }, { status: 400 })
    }

    if (!VALID_DOCUMENT_TYPES.has(documentType)) {
      return NextResponse.json({ error: "Tipo de documento invalido." }, { status: 400 })
    }

    if (!createdBy) {
      const remoteLinkOk = await validateRemoteLink(linkToken, employeeId)
      if (!remoteLinkOk) {
        return NextResponse.json({ error: "Sessao ou link remoto invalido para arquivar documento." }, { status: 401 })
      }
    }

    const sha256Hash = String(formData.get("sha256_hash") || "").trim()
    if (!/^[a-f0-9]{64}$/i.test(sha256Hash)) {
      return NextResponse.json({ error: "Hash SHA-256 invalido." }, { status: 400 })
    }

    const fileName = sanitizeFileName(String(formData.get("file_name") || pdfFile.name || "documento_assinado.pdf"))
    const storagePath = `signed-documents/${documentType}/${Date.now()}_${fileName}`
    const arrayBuffer = await pdfFile.arrayBuffer()

    const { error: uploadError } = await supabaseAdmin.storage
      .from("ppe_signatures")
      .upload(storagePath, arrayBuffer, {
        contentType: pdfFile.type || "application/pdf",
        upsert: false,
      })

    if (uploadError) {
      return NextResponse.json({ error: uploadError.message }, { status: 400 })
    }

    const { data: publicUrlData } = supabaseAdmin.storage
      .from("ppe_signatures")
      .getPublicUrl(storagePath)

    const deliveryIds = parseJsonField<string[]>(formData.get("delivery_ids"), [])
      .filter((id) => typeof id === "string" && id.length > 0)

    const metadata = parseJsonField<Record<string, unknown>>(formData.get("metadata"), {})
    const insertPayload = {
      document_type: documentType,
      employee_id: employeeId,
      delivery_id: String(formData.get("delivery_id") || "") || null,
      delivery_ids: deliveryIds,
      training_id: String(formData.get("training_id") || "") || null,
      file_name: fileName,
      document_url: publicUrlData.publicUrl,
      storage_path: storagePath,
      sha256_hash: sha256Hash.toLowerCase(),
      auth_method: String(formData.get("auth_method") || "") || null,
      signature_url: String(formData.get("signature_url") || "") || null,
      photo_evidence_url: String(formData.get("photo_evidence_url") || "") || null,
      ip_address: String(formData.get("ip_address") || "") || null,
      geo_location: String(formData.get("geo_location") || "") || null,
      user_agent: request.headers.get("user-agent"),
      metadata,
      created_by: createdBy,
    }

    const { data, error } = await supabaseAdmin
      .from("signed_documents")
      .insert([insertPayload])
      .select()
      .single()

    if (error) {
      if (isMissingAuditTable(error)) {
        await supabaseAdmin.storage.from("ppe_signatures").remove([storagePath])
        return NextResponse.json({
          error: "A tabela signed_documents ainda nao existe no Supabase. Rode o script signed_documents_audit.sql para ativar o arquivo juridico dos PDFs.",
        }, { status: 501 })
      }

      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ success: true, document: data })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Erro interno ao arquivar documento assinado."
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
