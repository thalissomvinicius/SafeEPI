import { NextResponse } from "next/server"
import { requireAuthorizedUser } from "@/lib/serverAuth"
import { supabaseAdmin } from "@/lib/supabaseAdmin"
import { PRIVATE_STORAGE_BUCKET } from "@/lib/privateStorage"
import { getClientIp } from "@/lib/getClientIp"
import { rateLimit, rateLimitExceededResponse } from "@/lib/rateLimit"
import { uploadFieldsSchema } from "@/lib/securitySchemas"
import { isValidationResponse, validateBody } from "@/lib/validateBody"
import { assertRequestSize, RequestTooLargeError } from "@/lib/requestSecurity"

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

function hasExecutableExtension(fileName: string) {
  return /\.(exe|sh|js|php|py|bat)$/i.test(fileName)
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
  const limited = await rateLimit(`upload:signed-documents-url:ip:${getClientIp(request)}`, 20, 60 * 60 * 1000)
  if (!limited.success) return rateLimitExceededResponse(limited.retryAfter)

  try {
  assertRequestSize(request, 64 * 1024)
  const formData = await request.formData()
  const { data: fields } = validateBody(uploadFieldsSchema, {
    document_type: formData.get("document_type") || undefined,
    employee_id: formData.get("employee_id") || undefined,
    link_token: formData.get("link_token") || undefined,
    company_id: formData.get("company_id") || undefined,
    file_name: formData.get("file_name") || undefined,
  })
  const documentType = fields.document_type || ""
  const employeeId = fields.employee_id || null
  const linkToken = fields.link_token || null
  const requestedCompanyId = fields.company_id || null

  if (!VALID_DOCUMENT_TYPES.has(documentType)) {
    return NextResponse.json({ error: "Tipo de documento invalido." }, { status: 400 })
  }

  const auth = await requireAuthorizedUser(request)
  let companyId: string | null = null

  if (linkToken) {
    companyId = await validateRemoteLink(linkToken, employeeId)
    if (!companyId) {
      return NextResponse.json({ error: "Sessao ou link remoto invalido para preparar upload." }, { status: 401 })
    }
  } else if (auth.authorized) {
    companyId = auth.user.role === "MASTER"
      ? requestedCompanyId
      : auth.user.company_id
  } else {
    return NextResponse.json({ error: "Sessao ou link remoto invalido para preparar upload." }, { status: 401 })
  }

  if (!companyId) {
    return NextResponse.json({ error: "Empresa atual nao identificada para preparar upload." }, { status: 400 })
  }

  const requestedFileName = fields.file_name || "documento_assinado.pdf"
  if (hasExecutableExtension(requestedFileName) || !requestedFileName.toLowerCase().endsWith(".pdf")) {
    return NextResponse.json({ error: "Nome ou extensao de arquivo invalida." }, { status: 400 })
  }

  const safeFileName = sanitizeFileName(requestedFileName)
  const storagePath = `signed-documents/${companyId}/${documentType}/${Date.now()}_${safeFileName}`
  const { data, error } = await supabaseAdmin.storage
    .from(PRIVATE_STORAGE_BUCKET)
    .createSignedUploadUrl(storagePath)

  if (error || !data) {
    console.error("[signed-documents/upload-url] signed upload error:", error)
    return NextResponse.json({ error: "Nao foi possivel preparar upload do PDF." }, { status: 400 })
  }

  return NextResponse.json({
    path: storagePath,
    token: data.token,
    signedUrl: data.signedUrl,
  })
  } catch (error: unknown) {
    if (isValidationResponse(error)) return error
    if (error instanceof RequestTooLargeError) {
      return NextResponse.json({ error: error.message }, { status: 413 })
    }
    console.error("[signed-documents/upload-url] unexpected error:", error)
    return NextResponse.json({ error: "Erro interno, tente novamente" }, { status: 500 })
  }
}
