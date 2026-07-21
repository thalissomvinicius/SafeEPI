import { NextResponse } from "next/server"
import { requireAuthorizedUser } from "@/lib/serverAuth"
import { supabaseAdmin } from "@/lib/supabaseAdmin"
import { rateLimit, rateLimitExceededResponse } from "@/lib/rateLimit"

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SCOPES = new Set(["own", "third_party", "all"])

function validDate(value: string | null): value is string {
  return Boolean(value && Number.isFinite(Date.parse(value)))
}

export async function GET(request: Request) {
  const auth = await requireAuthorizedUser(request)
  if (!auth.authorized) return auth.response

  const limited = await rateLimit(`dashboard:user:${auth.user.id}`, 120, 60 * 60 * 1000)
  if (!limited.success) return rateLimitExceededResponse(limited.retryAfter)

  const params = new URL(request.url).searchParams
  const requestedCompanyId = params.get("company_id")
  const scope = params.get("scope") || "own"
  const allHistory = params.get("all") === "true"
  const start = params.get("start")
  const end = params.get("end")
  const chartStart = params.get("chart_start")
  const chartEnd = params.get("chart_end")

  if (requestedCompanyId && !UUID_REGEX.test(requestedCompanyId)) {
    return NextResponse.json({ error: "Empresa invalida." }, { status: 400 })
  }
  if (!SCOPES.has(scope) || (!allHistory && (!validDate(start) || !validDate(end))) || !validDate(chartStart) || !validDate(chartEnd)) {
    return NextResponse.json({ error: "Filtros de dashboard invalidos." }, { status: 400 })
  }
  if (Date.parse(chartEnd) - Date.parse(chartStart) > 32 * 86400000) {
    return NextResponse.json({ error: "Intervalo do grafico excede 32 dias." }, { status: 400 })
  }

  const companyId = auth.user.role === "MASTER" ? requestedCompanyId : auth.user.company_id
  const periodStart = start as string
  const periodEnd = end as string

  let selectedEmployeeQuery = supabaseAdmin.from("employees").select("id", { count: "exact", head: true }).eq("active", true)
  let activeAllQuery = supabaseAdmin.from("employees").select("id", { count: "exact", head: true }).eq("active", true)
  let activeOwnQuery = supabaseAdmin.from("employees").select("id", { count: "exact", head: true }).eq("active", true).is("third_party_id", null)
  let activeThirdPartyQuery = supabaseAdmin.from("employees").select("id", { count: "exact", head: true }).eq("active", true).not("third_party_id", "is", null)
  let deliveryCountQuery = supabaseAdmin.from("deliveries").select("id", { count: "exact", head: true }).is("deleted_at", null)
  let signedDocumentCountQuery = supabaseAdmin.from("signed_documents").select("id", { count: "exact", head: true })
  const criticalCutoff = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10)
  let criticalCAsQuery = supabaseAdmin.from("ppes").select("id", { count: "exact", head: true }).eq("active", true).lte("ca_expiry_date", criticalCutoff)
  let lowStockQuery = supabaseAdmin.from("ppes").select("id", { count: "exact", head: true }).eq("active", true).lte("current_stock", 5)
  let recentDeliveriesQuery = supabaseAdmin
    .from("deliveries")
    .select("id,delivery_date,employee:employees(full_name),ppe:ppes(name)")
    .is("deleted_at", null)
    .order("delivery_date", { ascending: false })
    .limit(5)

  if (scope === "own") selectedEmployeeQuery = selectedEmployeeQuery.is("third_party_id", null)
  if (scope === "third_party") selectedEmployeeQuery = selectedEmployeeQuery.not("third_party_id", "is", null)

  if (companyId) {
    selectedEmployeeQuery = selectedEmployeeQuery.eq("company_id", companyId)
    activeAllQuery = activeAllQuery.eq("company_id", companyId)
    activeOwnQuery = activeOwnQuery.eq("company_id", companyId)
    activeThirdPartyQuery = activeThirdPartyQuery.eq("company_id", companyId)
    deliveryCountQuery = deliveryCountQuery.eq("company_id", companyId)
    signedDocumentCountQuery = signedDocumentCountQuery.eq("company_id", companyId)
    criticalCAsQuery = criticalCAsQuery.eq("company_id", companyId)
    lowStockQuery = lowStockQuery.eq("company_id", companyId)
    recentDeliveriesQuery = recentDeliveriesQuery.eq("company_id", companyId)
  }

  if (!allHistory) {
    deliveryCountQuery = deliveryCountQuery.gte("delivery_date", periodStart).lte("delivery_date", periodEnd)
    signedDocumentCountQuery = signedDocumentCountQuery.gte("created_at", periodStart).lte("created_at", periodEnd)
    recentDeliveriesQuery = recentDeliveriesQuery.gte("delivery_date", periodStart).lte("delivery_date", periodEnd)
  }

  const chartQuery = supabaseAdmin.rpc("safeepi_dashboard_delivery_buckets", {
    p_company_id: companyId,
    p_start: chartStart,
    p_end: chartEnd,
  })

  const [
    selectedEmployeeResult,
    activeAllResult,
    activeOwnResult,
    activeThirdPartyResult,
    deliveryCountResult,
    signedDocumentCountResult,
    criticalCAsResult,
    lowStockResult,
    recentDeliveriesResult,
    chartResult,
  ] = await Promise.all([
    selectedEmployeeQuery,
    activeAllQuery,
    activeOwnQuery,
    activeThirdPartyQuery,
    deliveryCountQuery,
    signedDocumentCountQuery,
    criticalCAsQuery,
    lowStockQuery,
    recentDeliveriesQuery,
    chartQuery,
  ])
  const results = [selectedEmployeeResult, activeAllResult, activeOwnResult, activeThirdPartyResult, deliveryCountResult, signedDocumentCountResult, criticalCAsResult, lowStockResult, recentDeliveriesResult, chartResult]
  const firstError = results.find((result) => result.error)?.error
  if (firstError) {
    console.error("[dashboard] summary failed:", firstError)
    return NextResponse.json({ error: "Falha ao carregar o dashboard." }, { status: 500 })
  }

  return NextResponse.json({
    stats: {
      deliveries: deliveryCountResult.count || 0,
      employees: selectedEmployeeResult.count || 0,
      criticalCAs: criticalCAsResult.count || 0,
      lowStock: lowStockResult.count || 0,
      signedDocuments: signedDocumentCountResult.count || 0,
    },
    employeeCounts: {
      own: activeOwnResult.count || 0,
      third_party: activeThirdPartyResult.count || 0,
      all: activeAllResult.count || 0,
    },
    recentDeliveries: recentDeliveriesResult.data || [],
    chartData: Array.isArray(chartResult.data) ? chartResult.data : [],
  })
}
