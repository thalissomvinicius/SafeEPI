import { NextResponse } from "next/server"
import { requireAuthorizedUser } from "@/lib/serverAuth"
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

async function validateRemoteLink(linkToken: string | null, employeeId: string | null) {
  if (!linkToken) return null

  const { data: link } = await supabaseAdmin
    .from("remote_links")
    .select("employee_id,company_id,status,expires_at")
    .eq("token", linkToken)
    .maybeSingle()

  if (!link) return null
  if (employeeId && link.employee_id !== employeeId) return null
  if (new Date(link.expires_at) < new Date()) return null
  if (link.status !== "completed" && link.status !== "pending") return null

  return link.company_id || null
}

export async function POST(request: Request) {
  const formData = await request.formData()
  const documentType = String(formData.get("document_type") || "")
  const employeeId = String(formData.get("employee_id") || "") || null
  const linkToken = String(formData.get("link_token") || "") || null
  const requestedCompanyId = String(formData.get("company_id") || "") || null

  if (!VALID_DOCUMENT_TYPES.has(documentType)) {
    return NextResponse.json({ error: "Tipo de documento invalido." }, { status: 400 })
  }

  const auth = await requireAuthorizedUser(request)
  let companyId: string | null = null

  if (auth.authorized) {
    companyId = auth.user.role === "MASTER"
      ? requestedCompanyId
      : auth.user.company_id
    if (!companyId && linkToken) {
      companyId = await validateRemoteLink(linkToken, employeeId)
    }
  } else {
    companyId = await validateRemoteLink(linkToken, employeeId)
    if (!companyId) {
      return NextResponse.json({ error: "Sessao ou link remoto invalido para preparar upload." }, { status: 401 })
    }
  }

  if (!companyId) {
    return NextResponse.json({ error: "Empresa atual nao identificada para preparar upload." }, { status: 400 })
  }

  const safeFileName = sanitizeFileName(String(formData.get("file_name") || "documento_assinado.pdf"))
  const storagePath = `signed-documents/${documentType}/${Date.now()}_${safeFileName}`
  const { data, error } = await supabaseAdmin.storage
    .from("ppe_signatures")
    .createSignedUploadUrl(storagePath)

  if (error || !data) {
    return NextResponse.json({ error: error?.message || "Nao foi possivel preparar upload do PDF." }, { status: 400 })
  }

  const { data: publicUrlData } = supabaseAdmin.storage
    .from("ppe_signatures")
    .getPublicUrl(storagePath)

  return NextResponse.json({
    path: storagePath,
    token: data.token,
    signedUrl: data.signedUrl,
    publicUrl: publicUrlData.publicUrl,
  })
}
