import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabaseAdmin"
import { requireAuthorizedUser } from "@/lib/serverAuth"
import { getSignedUrl, PRIVATE_STORAGE_BUCKET, signStorageValue, STORAGE_VIEW_EXPIRES_IN } from "@/lib/privateStorage"
import { getClientIp } from "@/lib/getClientIp"
import { rateLimit, rateLimitExceededResponse } from "@/lib/rateLimit"
import { isValidationResponse } from "@/lib/validateBody"
import { validateUpload } from "@/lib/validateUpload"
import { isValidGeoLocation } from "@/utils/geolocation"
import { assertRequestSize, RequestTooLargeError } from "@/lib/requestSecurity"
import { assertPdfBytes, calculateSha256 } from "@/lib/documentIntegrity"

const VALID_DOCUMENT_TYPES = new Set([
  "delivery",
  "remote_delivery",
  "return",
  "nr06",
  "training_certificate",
])

const LOCATION_REQUIRED_DOCUMENT_TYPES = new Set(["delivery", "remote_delivery"])
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

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

type RemoteLinkValidationResult =
  | { ok: true; companyId: string | null; linkId: string }
  | { ok: false }

async function validateRemoteLink(linkToken: string | null, employeeId: string | null): Promise<RemoteLinkValidationResult> {
  if (!linkToken) return { ok: false }

  const { data: link } = await supabaseAdmin
    .from("remote_links")
    .select("id,employee_id,company_id,status,expires_at")
    .eq("token", linkToken)
    .maybeSingle()

  if (!link) return { ok: false }
  if (employeeId && link.employee_id !== employeeId) return { ok: false }
  if (new Date(link.expires_at) < new Date()) return { ok: false }

  if (link.status !== "completed") return { ok: false }

  return { ok: true, companyId: link.company_id || null, linkId: link.id }
}

function isValidPreuploadedPath(path: string, documentType: string, companyId: string) {
  return path.startsWith(`signed-documents/${companyId}/${documentType}/`) && !path.includes("..")
}

function isTenantStoragePath(path: string, companyId: string) {
  return !path.includes("..") && (
    path.startsWith(`${companyId}/`) ||
    path.startsWith(`signed-documents/${companyId}/`)
  )
}

async function withSignedDocumentUrls<T extends {
  document_url?: string | null
  storage_path?: string | null
  signature_url?: string | null
  photo_evidence_url?: string | null
}>(document: T) {
  return {
    ...document,
    signature_storage_path: document.signature_url || null,
    photo_evidence_storage_path: document.photo_evidence_url || null,
    document_url: await signStorageValue(document.storage_path || document.document_url),
    signature_url: await signStorageValue(document.signature_url),
    photo_evidence_url: await signStorageValue(document.photo_evidence_url),
  }
}

export async function POST(request: Request) {
  const limited = await rateLimit(`upload:signed-documents:ip:${getClientIp(request)}`, 20, 60 * 60 * 1000)
  if (!limited.success) return rateLimitExceededResponse(limited.retryAfter)

  try {
    assertRequestSize(request, 25 * 1024 * 1024)
    const formData = await request.formData()
    const pdfFile = formData.get("pdfFile")
    const documentType = String(formData.get("document_type") || "")
    const employeeId = String(formData.get("employee_id") || "") || null
    const linkToken = String(formData.get("link_token") || "") || null
    const preuploadedStoragePath = String(formData.get("storage_path") || "")
    const hasPreuploadedPdf = Boolean(preuploadedStoragePath)
    const createdBy = await resolveUserId(request)
    const auth = await requireAuthorizedUser(request)
    let remoteCompanyId: string | null = null
    let remoteLinkId: string | null = null

    if (!VALID_DOCUMENT_TYPES.has(documentType)) {
      return NextResponse.json({ error: "Tipo de documento invalido." }, { status: 400 })
    }

    if (!hasPreuploadedPdf && (!pdfFile || !(pdfFile instanceof File) || pdfFile.size === 0)) {
      return NextResponse.json({ error: "PDF assinado nao informado." }, { status: 400 })
    }

    if (linkToken) {
      const remoteLink = await validateRemoteLink(linkToken, employeeId)
      if (!remoteLink.ok) {
        return NextResponse.json({ error: "Sessao ou link remoto invalido para arquivar documento." }, { status: 401 })
      }
      remoteCompanyId = remoteLink.companyId
      remoteLinkId = remoteLink.linkId
    } else if (!auth.authorized || !createdBy) {
      return NextResponse.json({ error: "Sessao ou link remoto invalido para arquivar documento." }, { status: 401 })
    }

    const declaredSha256Hash = String(formData.get("sha256_hash") || "").trim().toLowerCase()

    const geoLocation = String(formData.get("geo_location") || "").trim()
    if (LOCATION_REQUIRED_DOCUMENT_TYPES.has(documentType) && !isValidGeoLocation(geoLocation)) {
      return NextResponse.json({
        error: "Localizacao obrigatoria para arquivar assinatura. Permita a localizacao e tente novamente.",
      }, { status: 400 })
    }

    const fileName = sanitizeFileName(String(
      formData.get("file_name") ||
      (pdfFile instanceof File ? pdfFile.name : "") ||
      "documento_assinado.pdf"
    ))
    const companyId = remoteCompanyId ||
      (auth.authorized && auth.user.role === "MASTER"
        ? String(formData.get("company_id") || "") || null
        : auth.authorized
          ? auth.user.company_id
          : null)
    if (!companyId) {
      return NextResponse.json({ error: "Empresa atual nao identificada para arquivar documento." }, { status: 400 })
    }
    if (hasPreuploadedPdf && !isValidPreuploadedPath(preuploadedStoragePath, documentType, companyId)) {
      return NextResponse.json({ error: "Caminho do PDF pre-enviado invalido para esta empresa." }, { status: 403 })
    }

    let storagePath = preuploadedStoragePath
    let documentUrl = preuploadedStoragePath
    let pdfBytes: Uint8Array

    if (!hasPreuploadedPdf) {
      const uploadFile = pdfFile as File
      const validatedPdf = await validateUpload(uploadFile, "pdf")
      pdfBytes = new Uint8Array(validatedPdf.buffer)
      assertPdfBytes(pdfBytes)
      storagePath = `signed-documents/${companyId}/${documentType}/${Date.now()}_${fileName}`

      const { error: uploadError } = await supabaseAdmin.storage
        .from(PRIVATE_STORAGE_BUCKET)
        .upload(storagePath, validatedPdf.buffer, {
          contentType: validatedPdf.contentType,
          upsert: false,
        })

      if (uploadError) {
        console.error("[signed-documents] pdf upload error:", uploadError)
        return NextResponse.json({ error: "Operacao nao permitida" }, { status: 400 })
      }

      documentUrl = storagePath
    } else {
      const { data: storedPdf, error: downloadError } = await supabaseAdmin.storage
        .from(PRIVATE_STORAGE_BUCKET)
        .download(storagePath)
      if (downloadError || !storedPdf) {
        return NextResponse.json({ error: "PDF pre-enviado nao encontrado." }, { status: 400 })
      }
      pdfBytes = new Uint8Array(await storedPdf.arrayBuffer())
      assertPdfBytes(pdfBytes)
    }

    const sha256Hash = await calculateSha256(pdfBytes)
    if (declaredSha256Hash && declaredSha256Hash !== sha256Hash) {
      await supabaseAdmin.storage.from(PRIVATE_STORAGE_BUCKET).remove([storagePath])
      return NextResponse.json({ error: "O hash do PDF enviado nao corresponde aos bytes arquivados." }, { status: 400 })
    }

    let photoEvidenceUrl = String(formData.get("photo_evidence_url") || "") || null
    let photoEvidenceStoragePath: string | null = null
    const photoEvidenceFile = formData.get("photoEvidenceFile")
    if (photoEvidenceFile instanceof File && photoEvidenceFile.size > 0) {
      const validatedEvidence = await validateUpload(photoEvidenceFile, "image")
      const evidencePath = `signed-documents/${companyId}/evidence/${documentType}/${Date.now()}_${sanitizeFileName(photoEvidenceFile.name || `foto.${validatedEvidence.extension}`)}`
      photoEvidenceStoragePath = evidencePath
      const { error: evidenceUploadError } = await supabaseAdmin.storage
        .from(PRIVATE_STORAGE_BUCKET)
        .upload(evidencePath, validatedEvidence.buffer, {
          contentType: validatedEvidence.contentType,
          upsert: false,
        })

      if (evidenceUploadError) {
        console.error("[signed-documents] evidence upload error:", evidenceUploadError)
        await supabaseAdmin.storage.from(PRIVATE_STORAGE_BUCKET).remove([storagePath])
        return NextResponse.json({ error: "Operacao nao permitida" }, { status: 400 })
      }

      photoEvidenceUrl = evidencePath
    }

    const deliveryIds = parseJsonField<string[]>(formData.get("delivery_ids"), [])
      .filter((id) => typeof id === "string" && UUID_REGEX.test(id))
    const deliveryId = String(formData.get("delivery_id") || "") || null
    const referencedDeliveryIds = [...new Set([
      ...deliveryIds,
      ...(deliveryId ? [deliveryId] : []),
    ])]
    const signatureUrl = String(formData.get("signature_url") || "") || null
    if (signatureUrl && !isTenantStoragePath(signatureUrl, companyId)) {
      await supabaseAdmin.storage.from(PRIVATE_STORAGE_BUCKET).remove([storagePath, photoEvidenceStoragePath].filter((value): value is string => Boolean(value)))
      return NextResponse.json({ error: "Assinatura nao pertence a empresa atual." }, { status: 403 })
    }
    if (photoEvidenceUrl && !isTenantStoragePath(photoEvidenceUrl, companyId)) {
      await supabaseAdmin.storage.from(PRIVATE_STORAGE_BUCKET).remove([storagePath, photoEvidenceStoragePath].filter((value): value is string => Boolean(value)))
      return NextResponse.json({ error: "Evidencia facial nao pertence a empresa atual." }, { status: 403 })
    }

    if (referencedDeliveryIds.length > 0) {
      let deliveryQuery = supabaseAdmin
        .from("deliveries")
        .select("id")
        .in("id", referencedDeliveryIds)
        .eq("company_id", companyId)
        .is("deleted_at", null)
      if (employeeId) deliveryQuery = deliveryQuery.eq("employee_id", employeeId)
      const { data: scopedDeliveries, error: scopedError } = await deliveryQuery
      if (scopedError || scopedDeliveries?.length !== referencedDeliveryIds.length) {
        await supabaseAdmin.storage.from(PRIVATE_STORAGE_BUCKET).remove([storagePath, photoEvidenceStoragePath].filter((value): value is string => Boolean(value)))
        return NextResponse.json({ error: "Entrega referenciada nao pertence a empresa ou colaborador atual." }, { status: 403 })
      }
    }

    const metadata = parseJsonField<Record<string, unknown>>(formData.get("metadata"), {})
    const insertPayload = {
      company_id: companyId,
      document_type: documentType,
      employee_id: employeeId,
      delivery_id: deliveryId,
      delivery_ids: deliveryIds,
      training_id: String(formData.get("training_id") || "") || null,
      file_name: fileName,
      document_url: documentUrl,
      storage_path: storagePath,
      sha256_hash: sha256Hash.toLowerCase(),
      remote_link_id: remoteLinkId,
      auth_method: String(formData.get("auth_method") || "") || null,
      signature_url: signatureUrl,
      photo_evidence_url: photoEvidenceUrl,
      ip_address: String(formData.get("ip_address") || "") || null,
      geo_location: geoLocation || null,
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
      const cleanupPaths = [storagePath, photoEvidenceStoragePath].filter((path): path is string => Boolean(path))
      if (isMissingAuditTable(error)) {
        await supabaseAdmin.storage.from(PRIVATE_STORAGE_BUCKET).remove(cleanupPaths)
        return NextResponse.json({
          error: "A tabela signed_documents ainda nao existe no Supabase. Rode o script signed_documents_audit.sql para ativar o arquivo juridico dos PDFs.",
        }, { status: 501 })
      }

      await supabaseAdmin.storage.from(PRIVATE_STORAGE_BUCKET).remove(cleanupPaths)
      console.error("[signed-documents] insert error:", error)
      return NextResponse.json({ error: "Operacao nao permitida" }, { status: 400 })
    }

    const document = await withSignedDocumentUrls(data)
    if (document.storage_path && !document.document_url) {
      const signed = await getSignedUrl(PRIVATE_STORAGE_BUCKET, document.storage_path, STORAGE_VIEW_EXPIRES_IN)
      document.document_url = signed?.signedUrl || document.storage_path
    }

    return NextResponse.json({ success: true, document })
  } catch (error: unknown) {
    if (error instanceof RequestTooLargeError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    if (isValidationResponse(error)) return error
    console.error("[signed-documents] unexpected error:", error)
    return NextResponse.json({ error: "Erro interno, tente novamente" }, { status: 500 })
  }
}
