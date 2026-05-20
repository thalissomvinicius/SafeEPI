import { NextResponse } from "next/server"
import { requireAuthorizedUser } from "@/lib/serverAuth"
import { supabaseAdmin } from "@/lib/supabaseAdmin"
import { getSignedUrl, PRIVATE_STORAGE_BUCKET, STORAGE_VIEW_EXPIRES_IN } from "@/lib/privateStorage"
import { getClientIp } from "@/lib/getClientIp"
import { rateLimit, rateLimitExceededResponse } from "@/lib/rateLimit"
import { isValidationResponse } from "@/lib/validateBody"
import { validateUpload } from "@/lib/validateUpload"

const LOGO_BUCKET = PRIVATE_STORAGE_BUCKET

export async function POST(request: Request) {
  const limited = rateLimit(`upload:company-logo:ip:${getClientIp(request)}`, 20, 60 * 60 * 1000)
  if (!limited.success) return rateLimitExceededResponse(limited.retryAfter)

  const auth = await requireAuthorizedUser(request, ["MASTER"])
  if (!auth.authorized) return auth.response

  try {
    const formData = await request.formData()
    const companyId = formData.get("company_id")
    const logoFile = formData.get("logo")

    if (typeof companyId !== "string" || !companyId) {
      return NextResponse.json({ error: "Empresa nao informada." }, { status: 400 })
    }

    if (!(logoFile instanceof File)) {
      return NextResponse.json({ error: "Arquivo da logo nao enviado." }, { status: 400 })
    }

    const validatedLogo = await validateUpload(logoFile, "image")
    const storagePath = `company-logos/${companyId}/logo-${Date.now()}.${validatedLogo.extension}`

    const { error: uploadError } = await supabaseAdmin.storage
      .from(LOGO_BUCKET)
      .upload(storagePath, validatedLogo.buffer, {
        contentType: validatedLogo.contentType,
        upsert: true,
      })

    if (uploadError) {
      console.error("[companies/logo] storage error:", uploadError)
      return NextResponse.json({ error: "Operacao nao permitida" }, { status: 400 })
    }

    const signed = await getSignedUrl(LOGO_BUCKET, storagePath, STORAGE_VIEW_EXPIRES_IN)

    const { data: company, error: updateError } = await supabaseAdmin
      .from("companies")
      .update({ logo_url: storagePath })
      .eq("id", companyId)
      .select("*")
      .single()

    if (updateError) {
      console.error("[companies/logo] update error:", updateError)
      return NextResponse.json({ error: "Operacao nao permitida" }, { status: 400 })
    }

    return NextResponse.json({
      company: company ? { ...company, logo_url: signed?.signedUrl || storagePath, logo_storage_path: storagePath } : company,
      logo_url: signed?.signedUrl || null,
      path: storagePath,
    })
  } catch (err: unknown) {
    if (isValidationResponse(err)) return err
    console.error("[companies/logo] unexpected error:", err)
    return NextResponse.json({ error: "Erro interno, tente novamente" }, { status: 500 })
  }
}
