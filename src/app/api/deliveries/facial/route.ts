import { NextResponse } from "next/server"
import { z } from "zod"
import { supabaseAdmin } from "@/lib/supabaseAdmin"
import { authorizeFacialActor, facialErrorResponse } from "@/lib/facialServer"
import { isFacialV2Enabled } from "@/lib/facialFeature"
import { readJsonWithLimit, RequestTooLargeError } from "@/lib/requestSecurity"
import { getClientIp } from "@/lib/getClientIp"

const inputSchema = z.object({
  session_id: z.string().uuid(),
  context_hash: z.string().regex(/^[a-f0-9]{64}$/),
  idempotency_key: z.string().min(8).max(128).regex(/^[a-zA-Z0-9_-]+$/),
  accepted: z.literal(true),
  token: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
})

type StoredSession = {
  id: string; employee_id: string; company_id: string; actor_id: string | null
  remote_link_id: string | null; context_hash: string; decision: string
  capture_storage_path: string | null; expires_at: string; consumed_at: string | null
}

function uncertainResponse() {
  return NextResponse.json({
    error: "Nao foi possivel confirmar a resposta do banco. Mantenha esta tela e tente confirmar novamente; a mesma solicitacao nao duplica a entrega.",
    code: "FINALIZATION_UNCERTAIN", retry_same_request: true,
  }, { status: 503 })
}

export async function POST(request: Request) {
  try {
    if (!isFacialV2Enabled()) return NextResponse.json({ error: "Verificação facial indisponível neste ambiente. Use a assinatura manual.", code: "FACIAL_NOT_ENABLED" }, { status: 503 })
    const parsed = inputSchema.safeParse(await readJsonWithLimit(request, 8192))
    if (!parsed.success) {
      return NextResponse.json({ error: "Sessao, contexto e aceite expresso do recebimento sao obrigatorios." }, { status: 400 })
    }
    const input = parsed.data
    const { data, error: lookupError } = await supabaseAdmin.from("biometric_sessions")
      .select("id,employee_id,company_id,actor_id,remote_link_id,context_hash,decision,capture_storage_path,expires_at,consumed_at")
      .eq("id", input.session_id).maybeSingle()
    if (lookupError) {
      return NextResponse.json({ error: "Verificacao facial indisponivel. Confirme a instalacao da migracao facial." }, { status: 503 })
    }
    if (!data) return NextResponse.json({ error: "Sessao facial nao encontrada." }, { status: 404 })
    const session = data as StoredSession
    // A completed remote link may read the result of the same atomic operation;
    // it cannot start a new verification or create an additional delivery.
    const access = await authorizeFacialActor(request, session.employee_id, input.token || null, "verify", { allowCompletedRemote: true })
    if (access.companyId !== session.company_id || access.actorId !== session.actor_id || access.remoteLinkId !== session.remote_link_id) {
      return NextResponse.json({ error: "Esta verificacao pertence a outra sessao de recebimento." }, { status: 403 })
    }
    if (input.context_hash !== session.context_hash) {
      return NextResponse.json({ error: "Os itens nao correspondem a verificacao. Confira a entrega novamente." }, { status: 409 })
    }
    if (session.decision !== "approved" || !session.capture_storage_path || !session.capture_storage_path.startsWith(`${session.company_id}/signatures/facial/`)) {
      return NextResponse.json({ error: "Nenhuma verificacao facial aprovada para esta entrega. Use assinatura manual ou refaca a verificacao." }, { status: 409 })
    }
    if (!session.consumed_at && (!Number.isFinite(Date.parse(session.expires_at)) || Date.parse(session.expires_at) <= Date.now())) {
      return NextResponse.json({ error: "A verificacao expirou. Verifique o rosto novamente antes de confirmar." }, { status: 410 })
    }

    // The RPC locks/consumes the proof, checks the current profile and all item
    // scopes, writes the entire batch and stock movements in one transaction.
    // The client cannot supply a different photograph after verification.
    let result
    try {
      result = await supabaseAdmin.rpc("safeepi_finalize_facial_delivery", {
        p_session_id: session.id,
        p_actor_id: access.actorId,
        p_remote_link_id: access.remoteLinkId,
        p_context_hash: input.context_hash,
        p_idempotency_key: input.idempotency_key,
        p_signature_url: session.capture_storage_path,
        p_ip_address: getClientIp(request),
        p_accepted: true,
      })
    } catch {
      // Never delete the photograph: a network failure does not mean rollback.
      return uncertainResponse()
    }
    if (result.error) {
      const message = result.error.message || ""
      if (message.includes("insufficient_stock")) {
        return NextResponse.json({ error: "Estoque insuficiente. Nenhum item desta confirmacao foi registrado." }, { status: 409 })
      }
      if (/expired|revoked|profile_changed|scope|context|consumed|acceptance|invalid|not_approved|mismatch/.test(message)) {
        return NextResponse.json({ error: "A verificacao nao pode concluir esta entrega. Confira o cadastro e os itens ou use assinatura manual.", code: "FACIAL_PROOF_INVALID" }, { status: 409 })
      }
      return uncertainResponse()
    }
    const payload = result.data as { deliveries?: Array<{ id: string }>; [key: string]: unknown } | null
    if (!payload || !Array.isArray(payload.deliveries) || !payload.deliveries.length) return uncertainResponse()
    return NextResponse.json({ ...payload, data: payload.deliveries[0], deliveryIds: payload.deliveries.map(row => row.id) })
  } catch (error) {
    if (error instanceof RequestTooLargeError) return NextResponse.json({ error: error.message }, { status: error.status })
    return facialErrorResponse(error)
  }
}
