import { NextResponse } from "next/server"
import { requireAuthorizedUser } from "@/lib/serverAuth"
import { supabaseAdmin } from "@/lib/supabaseAdmin"

const LOGO_BUCKET = "ppe_signatures"

export async function POST(request: Request) {
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

    const extension = logoFile.name.split(".").pop()?.toLowerCase() || "png"
    const safeExtension = ["png", "jpg", "jpeg", "webp"].includes(extension) ? extension : "png"
    const storagePath = `company-logos/${companyId}/logo-${Date.now()}.${safeExtension}`

    const { error: uploadError } = await supabaseAdmin.storage
      .from(LOGO_BUCKET)
      .upload(storagePath, logoFile, {
        contentType: logoFile.type || "image/png",
        upsert: true,
      })

    if (uploadError) {
      return NextResponse.json({ error: uploadError.message }, { status: 400 })
    }

    const { data: publicData } = supabaseAdmin.storage
      .from(LOGO_BUCKET)
      .getPublicUrl(storagePath)

    const { data: company, error: updateError } = await supabaseAdmin
      .from("companies")
      .update({ logo_url: publicData.publicUrl })
      .eq("id", companyId)
      .select("*")
      .single()

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 400 })
    }

    return NextResponse.json({ company, logo_url: publicData.publicUrl })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Erro interno do servidor"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
