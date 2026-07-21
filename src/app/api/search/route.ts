import { NextResponse } from "next/server"
import { requireAuthorizedUser } from "@/lib/serverAuth"
import { supabaseAdmin } from "@/lib/supabaseAdmin"
import { rateLimit, rateLimitExceededResponse } from "@/lib/rateLimit"

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function escapeLikePattern(value: string) {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`)
}

export async function GET(request: Request) {
  const auth = await requireAuthorizedUser(request)
  if (!auth.authorized) return auth.response

  const limited = await rateLimit(`global-search:user:${auth.user.id}`, 60, 60 * 1000)
  if (!limited.success) return rateLimitExceededResponse(limited.retryAfter)

  const { searchParams } = new URL(request.url)
  const term = (searchParams.get("q") || "").trim().slice(0, 80)
  const requestedCompanyId = searchParams.get("company_id")

  if (term.length < 2) {
    return NextResponse.json({ employees: [], ppes: [], workplaces: [] })
  }

  if (requestedCompanyId && !UUID_REGEX.test(requestedCompanyId)) {
    return NextResponse.json({ error: "Empresa invalida." }, { status: 400 })
  }

  const companyId = auth.user.role === "MASTER" ? requestedCompanyId : auth.user.company_id
  const pattern = `%${escapeLikePattern(term)}%`

  let employeeQuery = supabaseAdmin
    .from("employees")
    .select("id,full_name,cpf")
    .eq("active", true)
    .ilike("full_name", pattern)
    .order("full_name", { ascending: true })
    .limit(5)
  let ppeQuery = supabaseAdmin
    .from("ppes")
    .select("id,name,ca_number")
    .eq("active", true)
    .ilike("name", pattern)
    .order("name", { ascending: true })
    .limit(5)
  let workplaceQuery = supabaseAdmin
    .from("workplaces")
    .select("id,name")
    .eq("active", true)
    .ilike("name", pattern)
    .order("name", { ascending: true })
    .limit(5)

  if (companyId) {
    employeeQuery = employeeQuery.eq("company_id", companyId)
    ppeQuery = ppeQuery.eq("company_id", companyId)
    workplaceQuery = workplaceQuery.eq("company_id", companyId)
  }

  const [employees, ppes, workplaces] = await Promise.all([
    employeeQuery,
    ppeQuery,
    workplaceQuery,
  ])

  const firstError = employees.error || ppes.error || workplaces.error
  if (firstError) {
    console.error("[global-search] query failed:", firstError)
    return NextResponse.json({ error: "Falha ao realizar a busca." }, { status: 500 })
  }

  return NextResponse.json({
    employees: employees.data || [],
    ppes: ppes.data || [],
    workplaces: workplaces.data || [],
  })
}
