import { NextResponse } from "next/server"
import { requireAuthorizedUser } from "@/lib/serverAuth"
import { supabaseAdmin } from "@/lib/supabaseAdmin"

const MAX_PHOTO_SIZE = 4 * 1024 * 1024

function sanitizePathPart(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80)
}

function getImageExtension(type: string) {
  if (type === "image/webp") return "webp"
  if (type === "image/jpeg") return "jpg"
  return "png"
}

export async function POST(request: Request) {
  const auth = await requireAuthorizedUser(request, ["MASTER", "ADMIN"])
  if (!auth.authorized) {
    return auth.response
  }

  try {
    const formData = await request.formData()
    const photoFile = formData.get("photoFile")
    const employeeId = String(formData.get("employee_id") || "new")
    const requestedCompanyId = String(formData.get("company_id") || "")
    const companyId = auth.user.role === "MASTER"
      ? requestedCompanyId
      : auth.user.company_id

    if (!companyId) {
      return NextResponse.json({ error: "Empresa atual nao identificada para salvar foto." }, { status: 400 })
    }

    if (!photoFile || !(photoFile instanceof File) || photoFile.size === 0) {
      return NextResponse.json({ error: "Arquivo de foto nao informado." }, { status: 400 })
    }

    if (photoFile.size > MAX_PHOTO_SIZE) {
      return NextResponse.json({ error: "Arquivo de foto excede 4MB." }, { status: 413 })
    }

    if (!photoFile.type.startsWith("image/")) {
      return NextResponse.json({ error: "Arquivo de foto precisa ser uma imagem." }, { status: 400 })
    }

    const safeCompanyId = sanitizePathPart(companyId)
    const safeEmployeeId = sanitizePathPart(employeeId || "employee")
    const extension = getImageExtension(photoFile.type)
    const fileName = `${safeCompanyId}/employees/emp_${Date.now()}_${safeEmployeeId}.${extension}`
    const buffer = await photoFile.arrayBuffer()

    const { error: uploadError } = await supabaseAdmin.storage
      .from("ppe_signatures")
      .upload(fileName, buffer, {
        contentType: photoFile.type || "image/png",
        upsert: false,
      })

    if (uploadError) {
      console.error("[employee-photo-upload] storage error:", uploadError)
      return NextResponse.json({ error: uploadError.message }, { status: 400 })
    }

    const { data: { publicUrl } } = supabaseAdmin.storage
      .from("ppe_signatures")
      .getPublicUrl(fileName)

    return NextResponse.json({ publicUrl, path: fileName })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Erro interno ao salvar foto."
    console.error("[employee-photo-upload] unexpected error:", error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
