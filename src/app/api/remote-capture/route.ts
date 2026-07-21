import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabaseAdmin"
import { BIOMETRIC_BUCKET, signStorageValue } from "@/lib/privateStorage"
import { getClientIp } from "@/lib/getClientIp"
import { rateLimit, rateLimitExceededResponse } from "@/lib/rateLimit"
import { readJsonWithLimit, RequestTooLargeError } from "@/lib/requestSecurity"
import { remoteCaptureSchema } from "@/lib/securitySchemas"
import { isValidationResponse, validateBody } from "@/lib/validateBody"
import { validateUploadBuffer } from "@/lib/validateUpload"
import {
  BIOMETRIC_KEY_VERSION,
  BiometricEncryptionConfigurationError,
  encryptBiometricDescriptor,
} from "@/lib/biometricEncryption"

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TOKEN_REGEX = /^[0-9a-f]{64}$/i

function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_REGEX.test(value)
}

function isValidToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_REGEX.test(value)
}

function dataUrlToBuffer(dataUrl: string) {
  const match = dataUrl.match(/^data:image\/(png|jpe?g|webp);base64,(.+)$/i)
  if (!match) return null
  const buffer = Buffer.from(match[2], "base64")
  const validated = validateUploadBuffer(buffer, "image")
  return { buffer, contentType: validated.contentType, extension: validated.extension }
}

async function uploadBiometricPhoto(path: string, image: NonNullable<ReturnType<typeof dataUrlToBuffer>>) {
  const uploadOptions = {
    contentType: image.contentType,
    upsert: false,
  }

  let result = await supabaseAdmin.storage.from(BIOMETRIC_BUCKET).upload(path, image.buffer, uploadOptions)
  if (!result.error) return { ok: true as const }

  const message = String(result.error.message || "").toLowerCase()
  const missingBucket = message.includes("bucket") && (message.includes("not found") || message.includes("does not exist"))

  if (missingBucket) {
    const { error: createError } = await supabaseAdmin.storage.createBucket(BIOMETRIC_BUCKET, {
      public: false,
    })

    const createMessage = String(createError?.message || "").toLowerCase()
    if (createError && !createMessage.includes("already exists")) {
      console.error("[/api/remote-capture][POST] create biometric bucket error:", createError)
      return { ok: false as const, error: createError }
    }

    result = await supabaseAdmin.storage.from(BIOMETRIC_BUCKET).upload(path, image.buffer, uploadOptions)
  }

  if (result.error) return { ok: false as const, error: result.error }
  return { ok: true as const }
}

async function loadValidLink(token: string, expectedEmployeeId: string, expectedType: string) {
  const { data: link } = await supabaseAdmin
    .from("remote_links")
    .select("id, employee_id, company_id, type, status, expires_at, data")
    .eq("token", token)
    .maybeSingle()

  if (!link) return { ok: false as const, status: 404, error: "Link nao encontrado." }
  if (link.employee_id !== expectedEmployeeId) {
    return { ok: false as const, status: 403, error: "Link nao corresponde ao colaborador." }
  }

  const linkType = link.type === "delivery" && link.data?.remoteType
    ? link.data.remoteType
    : link.type

  if (linkType !== expectedType) {
    return { ok: false as const, status: 403, error: "Tipo de link incompativel." }
  }
  if (new Date(link.expires_at) < new Date()) {
    await supabaseAdmin.from("remote_links").update({ status: "expired" }).eq("id", link.id)
    return { ok: false as const, status: 410, error: "Este link expirou." }
  }
  if (link.status !== "pending") {
    if (expectedType === "capture" && link.status === "completed") {
      const { data: employee } = await supabaseAdmin
        .from("employees")
        .select("photo_url")
        .eq("id", expectedEmployeeId)
        .maybeSingle()

      if (!employee?.photo_url) return { ok: true as const, link }
    }

    return { ok: false as const, status: 410, error: "Este link ja foi utilizado." }
  }

  return { ok: true as const, link }
}

export async function GET(request: Request) {
  try {
    const ipLimited = await rateLimit(`remote-capture:get:ip:${getClientIp(request)}`, 30, 60 * 60 * 1000)
    if (!ipLimited.success) return rateLimitExceededResponse(ipLimited.retryAfter)

    const { searchParams } = new URL(request.url)
    const id = searchParams.get("id")
    const token = searchParams.get("token")

    if (!isValidUuid(id)) {
      return NextResponse.json({ error: "ID do colaborador invalido." }, { status: 400 })
    }
    if (!isValidToken(token)) {
      return NextResponse.json({ error: "Token invalido." }, { status: 401 })
    }

    const validation = await loadValidLink(token, id, "capture")
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: validation.status })
    }
    if (!validation.link.company_id) {
      return NextResponse.json({ error: "Empresa do link nao identificada." }, { status: 400 })
    }

    const tokenLimited = await rateLimit(`remote-capture:get:link:${validation.link.id}`, 10, 60 * 60 * 1000)
    if (!tokenLimited.success) return rateLimitExceededResponse(tokenLimited.retryAfter)

    const { data: employee, error } = await supabaseAdmin
      .from("employees")
      .select("id, full_name, photo_url")
      .eq("id", id)
      .maybeSingle()

    if (error || !employee) {
      return NextResponse.json({ error: "Colaborador nao encontrado." }, { status: 404 })
    }

    return NextResponse.json({
      ...employee,
      photo_storage_path: employee.photo_url || null,
      photo_url: await signStorageValue(employee.photo_url, { bucket: BIOMETRIC_BUCKET }),
    })
  } catch (error: unknown) {
    console.error("[/api/remote-capture][GET] error:", error)
    return NextResponse.json({ error: "Erro interno do servidor." }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const ipLimited = await rateLimit(`remote-capture:post:ip:${getClientIp(request)}`, 20, 60 * 60 * 1000)
    if (!ipLimited.success) return rateLimitExceededResponse(ipLimited.retryAfter)

    const { data: body } = validateBody(remoteCaptureSchema, await readJsonWithLimit(request, 5 * 1024 * 1024))
    const { id, photo_url, face_descriptor, token } = body

    if (!isValidUuid(id)) {
      return NextResponse.json({ error: "ID do colaborador invalido." }, { status: 400 })
    }
    if (typeof photo_url !== "string" || !photo_url.trim()) {
      return NextResponse.json({ error: "URL da foto e obrigatoria." }, { status: 400 })
    }
    if (!isValidToken(token)) {
      return NextResponse.json({ error: "Token invalido." }, { status: 401 })
    }

    const normalizedDescriptor = Array.isArray(face_descriptor) && face_descriptor.length === 512
      ? face_descriptor
      : null
    if (
      face_descriptor &&
      (!Array.isArray(face_descriptor) ||
        (face_descriptor.length !== 0 && face_descriptor.length !== 512) ||
        face_descriptor.some(value => !Number.isFinite(value)))
    ) {
      return NextResponse.json({ error: "Descritor facial invalido." }, { status: 400 })
    }

    const validation = await loadValidLink(token, id, "capture")
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: validation.status })
    }

    const tokenLimited = await rateLimit(`remote-capture:post:link:${validation.link.id}`, 5, 60 * 60 * 1000)
    if (!tokenLimited.success) return rateLimitExceededResponse(tokenLimited.retryAfter)

    let imageToUpload: ReturnType<typeof dataUrlToBuffer> = null
    if (photo_url.startsWith("data:")) {
      imageToUpload = dataUrlToBuffer(photo_url)
      if (!imageToUpload) {
        return NextResponse.json({ error: "Foto invalida ou muito grande." }, { status: 400 })
      }
    }

    let storedPhotoPath = photo_url
    if (imageToUpload) {
      const companyPrefix = validation.link.company_id || "remote"
      storedPhotoPath = `${companyPrefix}/employees/remote_capture_${Date.now()}_${id}.${imageToUpload.extension}`
      const uploadResult = await uploadBiometricPhoto(storedPhotoPath, imageToUpload)

      if (!uploadResult.ok) {
        console.error("[/api/remote-capture][POST] storage error:", uploadResult.error)
        return NextResponse.json({ error: "Falha ao salvar foto. Tente novamente." }, { status: 500 })
      }
    }

    const biometricUpdate = normalizedDescriptor
      ? {
          face_descriptor: null,
          face_descriptor_encrypted: encryptBiometricDescriptor(
            normalizedDescriptor,
            validation.link.company_id,
          ),
          biometric_key_version: BIOMETRIC_KEY_VERSION,
        }
      : {
          face_descriptor: null,
          face_descriptor_encrypted: null,
          biometric_key_version: null,
        }

    const { data, error } = await supabaseAdmin.rpc("safeepi_complete_remote_capture", {
      p_remote_link_id: validation.link.id,
      p_employee_id: id,
      p_company_id: validation.link.company_id,
      p_photo_url: storedPhotoPath,
      p_face_descriptor_encrypted: biometricUpdate.face_descriptor_encrypted,
      p_biometric_key_version: biometricUpdate.biometric_key_version,
    })

    if (error) {
      console.error("[/api/remote-capture][POST] update error:", error)
      if (imageToUpload && storedPhotoPath) {
        await supabaseAdmin.storage.from(BIOMETRIC_BUCKET).remove([storedPhotoPath])
      }
      return NextResponse.json({ error: "Falha ao atualizar dados." }, { status: 500 })
    }

    return NextResponse.json({ success: true, employee: data })
  } catch (error: unknown) {
    if (error instanceof RequestTooLargeError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    if (isValidationResponse(error)) return error
    if (error instanceof BiometricEncryptionConfigurationError) {
      console.error("[/api/remote-capture][POST] biometric encryption is not configured")
      return NextResponse.json({ error: "Captura biometrica temporariamente indisponivel." }, { status: 503 })
    }
    console.error("[/api/remote-capture][POST] error:", error)
    return NextResponse.json({ error: "Erro interno do servidor." }, { status: 500 })
  }
}
