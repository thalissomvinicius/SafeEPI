import { NextResponse } from "next/server"
import { requireAuthorizedUser } from "@/lib/serverAuth"
import { supabaseAdmin } from "@/lib/supabaseAdmin"

const MAX_SIGNATURE_SIZE = 3 * 1024 * 1024

function sanitizePathPart(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80)
}

export async function POST(request: Request) {
  const auth = await requireAuthorizedUser(request)
  if (!auth.authorized) {
    return auth.response
  }

  try {
    const formData = await request.formData()
    const signatureFile = formData.get("signatureFile")
    const employeeId = String(formData.get("employee_id") || "")
    const authMethod = String(formData.get("auth_method") || "manual")
    const requestedCompanyId = String(formData.get("company_id") || "")
    const companyId = auth.user.role === "MASTER"
      ? requestedCompanyId || "global"
      : auth.user.company_id

    if (!signatureFile || !(signatureFile instanceof File) || signatureFile.size === 0) {
      return NextResponse.json({ error: "Arquivo de assinatura nao informado." }, { status: 400 })
    }

    if (!companyId) {
      return NextResponse.json({ error: "Empresa atual nao identificada para salvar assinatura." }, { status: 400 })
    }

    if (signatureFile.size > MAX_SIGNATURE_SIZE) {
      return NextResponse.json({ error: "Arquivo de assinatura excede 3MB." }, { status: 413 })
    }

    if (!signatureFile.type.startsWith("image/")) {
      return NextResponse.json({ error: "Arquivo de assinatura precisa ser uma imagem." }, { status: 400 })
    }

    const prefix = authMethod === "facial" ? "bio" : "sig"
    const safeCompanyId = sanitizePathPart(companyId)
    const safeEmployeeId = sanitizePathPart(employeeId || "employee")
    const extension = signatureFile.type === "image/webp" ? "webp" : signatureFile.type === "image/jpeg" ? "jpg" : "png"
    const fileName = `${safeCompanyId}/${prefix}_${Date.now()}_${safeEmployeeId}.${extension}`
    const buffer = await signatureFile.arrayBuffer()

    const { error: uploadError } = await supabaseAdmin.storage
      .from("ppe_signatures")
      .upload(fileName, buffer, {
        contentType: signatureFile.type || "image/png",
        upsert: false,
      })

    if (uploadError) {
      console.error("[signature-upload] storage error:", uploadError)
      return NextResponse.json({ error: uploadError.message }, { status: 400 })
    }

    const { data: { publicUrl } } = supabaseAdmin.storage
      .from("ppe_signatures")
      .getPublicUrl(fileName)

    return NextResponse.json({ publicUrl, path: fileName })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Erro interno ao salvar assinatura."
    console.error("[signature-upload] unexpected error:", error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
