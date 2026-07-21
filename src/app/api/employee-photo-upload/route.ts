import { NextResponse } from "next/server"
import { requireAuthorizedUser } from "@/lib/serverAuth"
import { supabaseAdmin } from "@/lib/supabaseAdmin"
import { BIOMETRIC_BUCKET, getSignedUrl, STORAGE_VIEW_EXPIRES_IN } from "@/lib/privateStorage"
import { getClientIp } from "@/lib/getClientIp"
import { rateLimit, rateLimitExceededResponse } from "@/lib/rateLimit"
import { uploadFieldsSchema } from "@/lib/securitySchemas"
import { isValidationResponse, validateBody } from "@/lib/validateBody"
import { validateUpload } from "@/lib/validateUpload"
import { assertRequestSize, RequestTooLargeError } from "@/lib/requestSecurity"

function sanitizePathPart(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80)
}

export async function POST(request: Request) {
  const limited = await rateLimit(`upload:employee-photo:ip:${getClientIp(request)}`, 20, 60 * 60 * 1000)
  if (!limited.success) return rateLimitExceededResponse(limited.retryAfter)

  const auth = await requireAuthorizedUser(request, ["MASTER", "ADMIN"])
  if (!auth.authorized) {
    return auth.response
  }

  try {
    assertRequestSize(request, 12 * 1024 * 1024)
    const formData = await request.formData()
    const photoFile = formData.get("photoFile")
    const { data: fields } = validateBody(uploadFieldsSchema, {
      employee_id: formData.get("employee_id") || undefined,
      company_id: formData.get("company_id") || undefined,
    })
    const employeeId = fields.employee_id || "new"
    const requestedCompanyId = fields.company_id || ""
    const companyId = auth.user.role === "MASTER"
      ? requestedCompanyId
      : auth.user.company_id

    if (!companyId) {
      return NextResponse.json({ error: "Empresa atual nao identificada para salvar foto." }, { status: 400 })
    }

    if (!photoFile || !(photoFile instanceof File) || photoFile.size === 0) {
      return NextResponse.json({ error: "Arquivo de foto nao informado." }, { status: 400 })
    }

    const validatedFile = await validateUpload(photoFile, "image")

    const safeCompanyId = sanitizePathPart(companyId)
    const safeEmployeeId = sanitizePathPart(employeeId || "employee")
    const extension = validatedFile.extension
    const fileName = `${safeCompanyId}/employees/emp_${Date.now()}_${safeEmployeeId}.${extension}`

    const { error: uploadError } = await supabaseAdmin.storage
      .from(BIOMETRIC_BUCKET)
      .upload(fileName, validatedFile.buffer, {
        contentType: validatedFile.contentType,
        upsert: false,
      })

    if (uploadError) {
      console.error("[employee-photo-upload] storage error:", uploadError)
      return NextResponse.json({ error: "Operacao nao permitida" }, { status: 400 })
    }

    const signed = await getSignedUrl(BIOMETRIC_BUCKET, fileName, STORAGE_VIEW_EXPIRES_IN)

    return NextResponse.json({ signedUrl: signed?.signedUrl || null, publicUrl: signed?.signedUrl || null, path: fileName })
  } catch (error: unknown) {
    if (isValidationResponse(error)) return error
    if (error instanceof RequestTooLargeError) {
      return NextResponse.json({ error: error.message }, { status: 413 })
    }
    console.error("[employee-photo-upload] unexpected error:", error)
    return NextResponse.json({ error: "Erro interno, tente novamente" }, { status: 500 })
  }
}
