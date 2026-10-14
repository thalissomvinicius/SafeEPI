import crypto from "crypto"
import { NextRequest, NextResponse } from "next/server"
import { requireAuthorizedUser } from "@/lib/serverAuth"
import { supabaseAdmin } from "@/lib/supabaseAdmin"
import { BIOMETRIC_BUCKET, signStorageValue } from "@/lib/privateStorage"
import { rateLimit, rateLimitExceededResponse } from "@/lib/rateLimit"
import { remoteLinkCompleteSchema, remoteLinkCreateSchema } from "@/lib/securitySchemas"
import { isValidationResponse, validateBody } from "@/lib/validateBody"
import { isRemoteLinkExpired, isRemoteSignatureOnly, RemoteLinkScopeError, requireActiveRemoteCompany, validateRemoteLinkScope } from "@/lib/remoteLinkScope"

function resolveCompanyId(authUser: { role: string; company_id: string | null }, requestedCompanyId: unknown) {
  if (authUser.role === "MASTER") return typeof requestedCompanyId === "string" && requestedCompanyId ? requestedCompanyId : null
  return authUser.company_id
}

type RemoteLinkRecord = {
  company_id: string
  employee_id: string
  type: string
  data?: unknown
  employee?: {
    photo_url?: string | null
    [key: string]: unknown
  } | null
  [key: string]: unknown
}

async function buildRemoteLinkResponse(link: RemoteLinkRecord) {
  const scope = await validateRemoteLinkScope(link)
  const employee = scope.employee

  return {
    ...link,
    data: scope.data,
    employee: {
      id: employee.id, full_name: employee.full_name, cpf: employee.cpf,
      job_title: employee.job_title, department: employee.department, workplace_id: employee.workplace_id,
      photo_url: link.type === "capture" ? await signStorageValue(employee.photo_url, { bucket: BIOMETRIC_BUCKET }) : null,
    },
    ppe: scope.ppe,
    workplace: scope.workplace,
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAuthorizedUser(request)
  if (!auth.authorized) {
    return auth.response
  }

  try {
    const { data: body } = validateBody(remoteLinkCreateSchema, await request.json())
    const { employee_id, type, data, expires_hours = 24, company_id } = body
    const companyId = resolveCompanyId(auth.user, company_id)

    if (!employee_id || !type) {
      return NextResponse.json({ error: "employee_id e type são obrigatórios" }, { status: 400 })
    }

    if (!companyId) {
      return NextResponse.json({ error: "Empresa atual nao encontrada para este usuario." }, { status: 400 })
    }

    if (type !== "delivery") {
      const limited = await rateLimit(`remote-links:create:company:${companyId}`, 10, 60 * 60 * 1000)
      if (!limited.success) return rateLimitExceededResponse(limited.retryAfter)
    }

    const dbType = type === "training_signature" ? "delivery" : type
    const requestedData = type === "training_signature"
      ? { ...(data || {}), remoteType: "training_signature" }
      : data || null
    const scope = await validateRemoteLinkScope({ company_id: companyId, employee_id, type: dbType, data: requestedData })
    const linkData = scope.data
    const keepsExistingDeliveryLinks = scope.signatureOnly

    if (type !== "training_signature" && !keepsExistingDeliveryLinks) {
      await supabaseAdmin
        .from("remote_links")
        .update({ status: "expired" })
        .eq("employee_id", employee_id)
        .eq("company_id", companyId)
        .eq("type", dbType)
        .eq("status", "pending")
    }

    const token = crypto.randomBytes(32).toString("hex")
    const expires_at = new Date(Date.now() + expires_hours * 60 * 60 * 1000).toISOString()

    const { data: link, error } = await supabaseAdmin
      .from("remote_links")
      .insert({
        employee_id,
        company_id: companyId,
        type: dbType,
        token,
        status: "pending",
        data: linkData,
        expires_at,
      })
      .select()
      .single()

    if (error) {
      console.error("[remote-links] Create error:", error)
      return NextResponse.json({ error: "Erro interno, tente novamente" }, { status: 500 })
    }

    return NextResponse.json({ link })
  } catch (err: unknown) {
    if (err instanceof RemoteLinkScopeError) return NextResponse.json({ error: err.message }, { status: err.status })
    if (isValidationResponse(err)) return err
    console.error("[remote-links] Unexpected error:", err)
    return NextResponse.json({ error: "Erro interno, tente novamente" }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const token = searchParams.get("token")
    const includeCompleted = searchParams.get("include_completed") === "1"

    if (!token) {
      const auth = await requireAuthorizedUser(request)
      if (!auth.authorized) {
        return auth.response
      }

      const type = searchParams.get("type") || "delivery"
      const status = searchParams.get("status") || "pending"
      const signaturePendingOnly = searchParams.get("signature_pending_only") === "1"
      const companyId = resolveCompanyId(auth.user, searchParams.get("company_id"))

      if (!companyId) {
        return NextResponse.json({ error: "Empresa atual nao encontrada para este usuario." }, { status: 400 })
      }
      await requireActiveRemoteCompany(companyId)

      let query = supabaseAdmin
        .from("remote_links")
        .select("id, employee_id, company_id, type, token, status, data, expires_at, completed_at, created_at, employee:employees(id, full_name, cpf, company_id, active)")
        .eq("company_id", companyId)
        .eq("type", type)
        .order("created_at", { ascending: false })
        .limit(100)

      if (status !== "all") {
        query = query.eq("status", status)
      }

      const { data: links, error } = await query

      if (error) {
        console.error("[remote-links] List error:", error)
        return NextResponse.json({ error: "Nao foi possivel carregar links pendentes." }, { status: 500 })
      }

      const expiredIds = (links || [])
        .filter((link) => link.status === "pending" && isRemoteLinkExpired(link.expires_at))
        .map((link) => link.id)

      if (expiredIds.length > 0) {
        await supabaseAdmin
          .from("remote_links")
          .update({ status: "expired" })
          .in("id", expiredIds)
      }

      const filteredLinks = (links || [])
        .filter((link) => !(link.status === "pending" && isRemoteLinkExpired(link.expires_at)))
        .filter((link) => {
          const employee = Array.isArray(link.employee) ? link.employee[0] : link.employee
          return employee?.company_id === companyId && employee.active === true
        })
        .filter((link) => {
          if (!signaturePendingOnly) return true
          return isRemoteSignatureOnly(link.data)
        })

      return NextResponse.json({ links: filteredLinks })
    }

    if (!/^[0-9a-f]{64}$/i.test(token)) return NextResponse.json({ error: "Link não encontrado ou inválido.", status: "invalid" }, { status: 404 })

    const { data: link, error } = await supabaseAdmin
      .from("remote_links")
      .select("id, employee_id, company_id, type, token, status, data, expires_at, completed_at, created_at")
      .eq("token", token)
      .single()

    if (error || !link) {
      return NextResponse.json({ error: "Link não encontrado ou inválido.", status: "invalid" }, { status: 404 })
    }

    if (isRemoteLinkExpired(link.expires_at)) {
      await supabaseAdmin
        .from("remote_links")
        .update({ status: "expired" })
        .eq("id", link.id)
        .eq("status", "pending")

      return NextResponse.json({ error: "Este link expirou. Solicite um novo link ao responsável.", status: "expired" }, { status: 410 })
    }

    const responseLink = await buildRemoteLinkResponse(link)
    const completedCaptureWithoutPhoto = link.status === "completed" && link.type === "capture" && !responseLink.employee.photo_url

    if (link.status === "completed" && !includeCompleted && !completedCaptureWithoutPhoto) {
      return NextResponse.json({ error: "Este link já foi utilizado.", status: "completed" }, { status: 410 })
    }

    if (link.status === "expired") {
      return NextResponse.json({ error: "Este link expirou. Solicite um novo link ao responsável.", status: "expired" }, { status: 410 })
    }

    return NextResponse.json({
      link: responseLink,
    }, { headers: { "Cache-Control": "no-store, private" } })
  } catch (err) {
    if (err instanceof RemoteLinkScopeError) return NextResponse.json({ error: err.message }, { status: err.status })
    console.error("[remote-links] GET error:", err)
    return NextResponse.json({ error: "Erro interno" }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireAuthorizedUser(request)
  if (!auth.authorized) {
    return auth.response
  }

  try {
    const { data: body } = validateBody(remoteLinkCompleteSchema, await request.json())
    const { token } = body

    if (!token) {
      return NextResponse.json({ error: "Token não informado" }, { status: 400 })
    }

    const lookup = await supabaseAdmin.from("remote_links")
      .select("id, company_id, employee_id, type, data, status, expires_at").eq("token", token).maybeSingle()
    if (lookup.error) return NextResponse.json({ error: "Não foi possível conferir o link." }, { status: 503 })
    if (!lookup.data || (auth.user.role !== "MASTER" && lookup.data.company_id !== auth.user.company_id)) return NextResponse.json({ error: "Link não encontrado." }, { status: 404 })
    if (lookup.data.status !== "pending" || isRemoteLinkExpired(lookup.data.expires_at)) return NextResponse.json({ error: "Este link não está mais disponível." }, { status: 410 })
    await validateRemoteLinkScope(lookup.data)
    const { data: link, error } = await supabaseAdmin
      .from("remote_links")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("token", token)
      .eq("company_id", lookup.data.company_id)
      .eq("status", "pending")
      .select()
      .single()

    if (error || !link) {
      return NextResponse.json({ error: "Não foi possível completar o link." }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    if (err instanceof RemoteLinkScopeError) return NextResponse.json({ error: err.message }, { status: err.status })
    if (isValidationResponse(err)) return err
    console.error("[remote-links] PUT error:", err)
    return NextResponse.json({ error: "Erro interno" }, { status: 500 })
  }
}
