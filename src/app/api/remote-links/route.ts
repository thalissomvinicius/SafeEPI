import crypto from "crypto"
import { NextRequest, NextResponse } from "next/server"
import { requireAuthorizedUser } from "@/lib/serverAuth"
import { supabaseAdmin } from "@/lib/supabaseAdmin"
import { BIOMETRIC_BUCKET, signStorageValue } from "@/lib/privateStorage"
import { rateLimit, rateLimitExceededResponse } from "@/lib/rateLimit"
import { remoteLinkCompleteSchema, remoteLinkCreateSchema } from "@/lib/securitySchemas"
import { isValidationResponse, validateBody } from "@/lib/validateBody"

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function resolveCompanyId(authUser: { role: string; company_id: string | null }, requestedCompanyId: unknown) {
  if (authUser.role === "MASTER") return typeof requestedCompanyId === "string" && requestedCompanyId ? requestedCompanyId : null
  return authUser.company_id
}

function getStringFromLinkData(data: unknown, key: string) {
  if (!data || typeof data !== "object") return ""
  const value = (data as Record<string, unknown>)[key]
  return typeof value === "string" ? value : ""
}

function getFirstPpeIdFromLinkData(data: unknown) {
  const directPpeId = getStringFromLinkData(data, "p")
  if (UUID_REGEX.test(directPpeId)) return directPpeId

  if (!data || typeof data !== "object") return ""
  const items = (data as { items?: unknown }).items
  if (!Array.isArray(items) || !items[0] || typeof items[0] !== "object") return ""
  const itemPpeId = (items[0] as { ppeId?: unknown }).ppeId
  return typeof itemPpeId === "string" && UUID_REGEX.test(itemPpeId) ? itemPpeId : ""
}

type RemoteLinkRecord = {
  data?: unknown
  employee?: {
    photo_url?: string | null
    [key: string]: unknown
  } | null
  [key: string]: unknown
}

async function buildRemoteLinkResponse(link: RemoteLinkRecord) {
  const ppeId = getFirstPpeIdFromLinkData(link.data)
  const workplaceId = getStringFromLinkData(link.data, "w")

  const [ppeResult, workplaceResult] = await Promise.all([
    ppeId
      ? supabaseAdmin
          .from("ppes")
          .select("id, name, ca_number, ca_expiry_date, active, company_id")
          .eq("id", ppeId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    UUID_REGEX.test(workplaceId)
      ? supabaseAdmin
          .from("workplaces")
          .select("id, name, address, company_id, third_party_id")
          .eq("id", workplaceId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  return {
    ...link,
    employee: link.employee
      ? {
          ...link.employee,
          photo_storage_path: link.employee.photo_url || null,
          photo_url: await signStorageValue(link.employee.photo_url, { bucket: BIOMETRIC_BUCKET }),
        }
      : link.employee,
    ppe: ppeResult.data || null,
    workplace: workplaceResult.data || null,
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

    const limited = rateLimit(`remote-links:create:company:${companyId}`, 10, 60 * 60 * 1000)
    if (!limited.success) return rateLimitExceededResponse(limited.retryAfter)

    const dbType = type === "training_signature" ? "delivery" : type
    const linkData = type === "training_signature"
      ? { ...(data || {}), remoteType: "training_signature" }
      : data || null
    const keepsExistingDeliveryLinks =
      !!linkData &&
      typeof linkData === "object" &&
      (linkData as { signaturePendingOnly?: unknown }).signaturePendingOnly === true

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

      let query = supabaseAdmin
        .from("remote_links")
        .select("id, employee_id, company_id, type, token, status, data, expires_at, completed_at, created_at, employee:employees(id, full_name, cpf)")
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

      const now = new Date()
      const expiredIds = (links || [])
        .filter((link) => link.status === "pending" && new Date(link.expires_at) < now)
        .map((link) => link.id)

      if (expiredIds.length > 0) {
        await supabaseAdmin
          .from("remote_links")
          .update({ status: "expired" })
          .in("id", expiredIds)
      }

      const filteredLinks = (links || [])
        .filter((link) => !(link.status === "pending" && new Date(link.expires_at) < now))
        .filter((link) => {
          if (!signaturePendingOnly) return true
          return (
            !!link.data &&
            typeof link.data === "object" &&
            (link.data as { signaturePendingOnly?: unknown }).signaturePendingOnly === true
          )
        })

      return NextResponse.json({ links: filteredLinks })
    }

    const { data: link, error } = await supabaseAdmin
      .from("remote_links")
      .select("*, employee:employees(id, full_name, cpf, photo_url, job_title, department, workplace_id)")
      .eq("token", token)
      .single()

    if (error || !link) {
      return NextResponse.json({ error: "Link não encontrado ou inválido.", status: "invalid" }, { status: 404 })
    }

    const completedCaptureWithoutPhoto = link.status === "completed" && link.type === "capture" && !link.employee?.photo_url

    if (link.status === "completed" && includeCompleted) {
      return NextResponse.json({
        link: await buildRemoteLinkResponse(link),
      })
    }

    if (new Date(link.expires_at) < new Date()) {
      await supabaseAdmin
        .from("remote_links")
        .update({ status: "expired" })
        .eq("id", link.id)

      return NextResponse.json({ error: "Este link expirou. Solicite um novo link ao responsável.", status: "expired" }, { status: 410 })
    }

    if (link.status === "completed" && !includeCompleted && !completedCaptureWithoutPhoto) {
      return NextResponse.json({ error: "Este link já foi utilizado.", status: "completed" }, { status: 410 })
    }

    if (link.status === "expired") {
      return NextResponse.json({ error: "Este link expirou. Solicite um novo link ao responsável.", status: "expired" }, { status: 410 })
    }

    return NextResponse.json({
      link: await buildRemoteLinkResponse(link),
    })
  } catch (err) {
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

    const { data: link, error } = await supabaseAdmin
      .from("remote_links")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("token", token)
      .eq("status", "pending")
      .select()
      .single()

    if (error || !link) {
      return NextResponse.json({ error: "Não foi possível completar o link." }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    if (isValidationResponse(err)) return err
    console.error("[remote-links] PUT error:", err)
    return NextResponse.json({ error: "Erro interno" }, { status: 500 })
  }
}
