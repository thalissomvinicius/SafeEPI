import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { requireAuthorizedUser } from "@/lib/serverAuth"
import { supabaseAdmin } from "@/lib/supabaseAdmin"
import { readJsonWithLimit, RequestTooLargeError } from "@/lib/requestSecurity"
import { PRIVATE_STORAGE_BUCKET } from "@/lib/privateStorage"
import { assessFingerprintEvidence } from "@/lib/fingerprintSecurity"

function resolveCompanyId(
  authUser: { role: string; company_id: string | null },
  requestedCompanyId: unknown,
) {
  if (authUser.role === "MASTER") {
    return typeof requestedCompanyId === "string" && requestedCompanyId ? requestedCompanyId : null
  }
  return authUser.company_id
}

const createDeliverySchema = z.object({
  company_id: z.string().uuid().nullable().optional(),
  employee_id: z.string().uuid(),
  ppe_id: z.string().uuid(),
  workplace_id: z.string().uuid().nullable().optional(),
  third_party_id: z.string().uuid().nullable().optional(),
  reason: z.enum([
    "Primeira Entrega",
    "Substituição (Desgaste/Validade)",
    "Substituicao (Desgaste/Validade)",
    "Perda",
    "Dano",
  ]),
  quantity: z.number().int().min(1).max(1000),
  signature_url: z.string().max(1024).nullable().optional(),
  auth_method: z.enum(["manual", "facial", "manual_facial", "fingerprint"]).nullable().optional(),
  fingerprint_event_id: z.string().uuid().nullable().optional(),
  fingerprint_batch_id: z.string().uuid().nullable().optional(),
  ip_address: z.string().max(120).nullable().optional(),
  delivery_date: z.string().datetime().nullable().optional(),
  idempotency_key: z.string().min(8).max(128),
})

type DeliveryFingerprintCommand = {
  id: string
  operation: "enroll" | "verify" | "delete"
  status: "queued" | "processing" | "completed" | "failed" | "cancelled" | "expired"
  employee_id: string
  matched_employee_id: string | null
  completed_at: string | null
  expires_at: string
  result_hash: string | null
  delivery_batch_id: string | null
}

export async function POST(request: NextRequest) {
  const auth = await requireAuthorizedUser(request, ["MASTER", "ADMIN", "ALMOXARIFE"])
  if (!auth.authorized) return auth.response

  let signaturePath: string | null = null
  const cleanupSignature = async () => {
    if (!signaturePath) return
    await supabaseAdmin.storage.from(PRIVATE_STORAGE_BUCKET).remove([signaturePath])
    signaturePath = null
  }

  try {
    const parsed = createDeliverySchema.safeParse(await readJsonWithLimit(request, 32 * 1024))
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados da entrega invalidos." }, { status: 400 })
    }

    const input = parsed.data
    const companyId = resolveCompanyId(auth.user, input.company_id)
    if (!companyId) {
      return NextResponse.json({ error: "Empresa atual nao encontrada para este usuario." }, { status: 400 })
    }

    signaturePath = input.signature_url || null
    if (signaturePath && !signaturePath.startsWith(`${companyId}/`)) {
      return NextResponse.json({ error: "Assinatura nao pertence a empresa atual." }, { status: 403 })
    }

    let fingerprintCommand: DeliveryFingerprintCommand | null = null

    if (input.auth_method === "fingerprint") {
      if (!input.fingerprint_event_id || !input.fingerprint_batch_id || signaturePath) {
        return NextResponse.json({ error: "Comprovacao biometrica incompleta." }, { status: 400 })
      }

      const { data: command, error: commandError } = await supabaseAdmin
        .from("fingerprint_commands")
        .select("id,operation,status,employee_id,matched_employee_id,completed_at,expires_at,result_hash,delivery_batch_id")
        .eq("id", input.fingerprint_event_id)
        .eq("company_id", companyId)
        .maybeSingle()
      if (commandError || !command) {
        return NextResponse.json({ error: "Leitura biometrica nao encontrada." }, { status: 404 })
      }

      fingerprintCommand = command as DeliveryFingerprintCommand
      const assessment = assessFingerprintEvidence({
        id: command.id,
        operation: command.operation,
        status: command.status,
        employeeId: command.employee_id,
        matchedEmployeeId: command.matched_employee_id,
        completedAt: command.completed_at,
        expiresAt: command.expires_at,
      }, { expectedEmployeeId: input.employee_id })
      if (!assessment.valid || !command.result_hash) {
        return NextResponse.json({ error: "Leitura biometrica expirada ou invalida. Faça uma nova leitura." }, { status: 409 })
      }

      if (command.delivery_batch_id && command.delivery_batch_id !== input.fingerprint_batch_id) {
        return NextResponse.json({ error: "Esta leitura biometrica ja foi usada em outra entrega." }, { status: 409 })
      }
      if (!command.delivery_batch_id) {
        const { data: claimedCommand, error: claimError } = await supabaseAdmin
          .from("fingerprint_commands")
          .update({ delivery_batch_id: input.fingerprint_batch_id })
          .eq("id", command.id)
          .is("delivery_batch_id", null)
          .select("id")
          .maybeSingle()
        if (claimError) {
          return NextResponse.json({ error: "Falha ao reservar a leitura biometrica." }, { status: 500 })
        }
        if (!claimedCommand) {
          const { data: concurrentlyClaimed } = await supabaseAdmin
            .from("fingerprint_commands")
            .select("delivery_batch_id")
            .eq("id", command.id)
            .maybeSingle()
          if (concurrentlyClaimed?.delivery_batch_id !== input.fingerprint_batch_id) {
            return NextResponse.json({ error: "Esta leitura biometrica ja foi usada em outra entrega." }, { status: 409 })
          }
        }
      }

      const { data: existingLinks, error: linkLookupError } = await supabaseAdmin
        .from("fingerprint_delivery_links")
        .select("batch_id")
        .eq("command_id", command.id)
        .limit(1)
      if (linkLookupError) {
        return NextResponse.json({ error: "Falha ao validar o uso da leitura biometrica." }, { status: 500 })
      }
      if (existingLinks?.[0]?.batch_id && existingLinks[0].batch_id !== input.fingerprint_batch_id) {
        return NextResponse.json({ error: "Esta leitura biometrica ja foi usada em outra entrega." }, { status: 409 })
      }
    } else if (input.fingerprint_event_id || input.fingerprint_batch_id) {
      return NextResponse.json({ error: "Evidencia biometrica nao corresponde ao metodo informado." }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin.rpc("safeepi_create_delivery", {
      p_company_id: companyId,
      p_employee_id: input.employee_id,
      p_ppe_id: input.ppe_id,
      p_workplace_id: input.workplace_id || null,
      p_third_party_id: input.third_party_id || null,
      p_reason: input.reason,
      p_quantity: input.quantity,
      p_signature_url: signaturePath,
      p_auth_method: input.auth_method || "manual",
      p_ip_address: input.ip_address || "",
      p_delivery_date: input.delivery_date || new Date().toISOString(),
      p_idempotency_key: input.idempotency_key,
      p_created_by_id: auth.user.id,
      p_created_by_name: auth.user.email || "Usuario SafeEPI",
      p_remote_link_id: null,
      p_auto_return_motive: null,
      p_auto_return_restock: false,
    })

    if (error) {
      await cleanupSignature()
      const status = error.message.includes("insufficient_stock") ? 409 : error.message.includes("not_found") ? 404 : 500
      return NextResponse.json({
        error: status === 409 ? "Estoque insuficiente para concluir a entrega." :
          status === 404 ? "Colaborador ou EPI nao encontrado na empresa atual." : "Erro interno ao registrar entrega.",
      }, { status })
    }

    const result = data as { delivery?: unknown } | null
    const delivery = result?.delivery as { id?: string } | null | undefined

    if (fingerprintCommand && input.fingerprint_batch_id) {
      if (!delivery?.id || !z.string().uuid().safeParse(delivery.id).success) {
        return NextResponse.json({ error: "Entrega criada sem identificador auditavel." }, { status: 500 })
      }
      const { error: linkError } = await supabaseAdmin.from("fingerprint_delivery_links").insert({
        company_id: companyId,
        command_id: fingerprintCommand.id,
        delivery_id: delivery.id,
        batch_id: input.fingerprint_batch_id,
      })
      if (linkError) {
        const { error: voidError } = await supabaseAdmin.rpc("safeepi_void_delivery", {
          p_company_id: companyId,
          p_delivery_id: delivery.id,
          p_deleted_by: auth.user.id,
          p_deleted_reason: "Falha no vinculo da evidencia biometrica",
        })
        if (voidError) console.error("[API deliveries] biometric compensation failed", voidError.message)
        return NextResponse.json({ error: "Nao foi possivel vincular a leitura. A entrega foi estornada." }, { status: 500 })
      }
    }

    signaturePath = null
    return NextResponse.json({ data: result?.delivery || null })
  } catch (error) {
    await cleanupSignature()
    if (error instanceof RequestTooLargeError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("[API deliveries] Atomic create error:", error)
    return NextResponse.json({ error: "Erro interno ao registrar entrega." }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAuthorizedUser(request, ["MASTER"])
  if (!auth.authorized) return auth.response

  try {
    const { searchParams } = new URL(request.url)
    const deliveryId = searchParams.get("id")
    const companyId = resolveCompanyId(auth.user, searchParams.get("company_id"))
    const reason = searchParams.get("reason")?.trim().slice(0, 250) || "Exclusao administrativa"

    if (!deliveryId || !z.string().uuid().safeParse(deliveryId).success) {
      return NextResponse.json({ error: "ID da entrega invalido." }, { status: 400 })
    }
    if (!companyId) {
      return NextResponse.json({ error: "Empresa da entrega e obrigatoria para MASTER." }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin.rpc("safeepi_void_delivery", {
      p_company_id: companyId,
      p_delivery_id: deliveryId,
      p_deleted_by: auth.user.id,
      p_deleted_reason: reason,
    })

    if (error) {
      const status = error.message.includes("delivery_not_found") ? 404 : 500
      return NextResponse.json({
        error: status === 404 ? "Entrega nao encontrada." : "Erro interno ao estornar entrega.",
      }, { status })
    }

    const result = data as { restored_quantity?: number } | null
    return NextResponse.json({
      ok: true,
      restored_quantity: result?.restored_quantity || 0,
      evidence_preserved: true,
    })
  } catch (error) {
    console.error("[API deliveries] Atomic void error:", error)
    return NextResponse.json({ error: "Erro interno ao estornar entrega." }, { status: 500 })
  }
}
