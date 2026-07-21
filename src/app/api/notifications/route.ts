import { NextResponse } from "next/server"
import { requireAuthorizedUser } from "@/lib/serverAuth"
import { supabaseAdmin } from "@/lib/supabaseAdmin"
import { rateLimit, rateLimitExceededResponse } from "@/lib/rateLimit"

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function GET(request: Request) {
  const auth = await requireAuthorizedUser(request)
  if (!auth.authorized) return auth.response

  const limited = await rateLimit(`notifications:user:${auth.user.id}`, 30, 60 * 60 * 1000)
  if (!limited.success) return rateLimitExceededResponse(limited.retryAfter)

  const requestedCompanyId = new URL(request.url).searchParams.get("company_id")
  if (requestedCompanyId && !UUID_REGEX.test(requestedCompanyId)) {
    return NextResponse.json({ error: "Empresa invalida." }, { status: 400 })
  }

  const companyId = auth.user.role === "MASTER" ? requestedCompanyId : auth.user.company_id
  const { data, error } = await supabaseAdmin.rpc("safeepi_notification_summary", {
    p_company_id: companyId,
  })

  if (error) {
    console.error("[notifications] summary failed:", error)
    return NextResponse.json({ error: "Falha ao carregar alertas." }, { status: 500 })
  }

  return NextResponse.json({ notifications: Array.isArray(data) ? data : [] })
}
