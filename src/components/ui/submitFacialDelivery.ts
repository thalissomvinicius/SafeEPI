import { api } from "@/services/api"
import type { Delivery } from "@/types/database"
import type { BiometricReceiptMetadata } from "@/utils/pdfGenerator"
import type { FacialSubmission } from "./FacialDeliveryConfirmation"

export type FacialDeliveryResult = {
  data: Delivery
  deliveries: Delivery[]
  deliveryIds: string[]
  session_id: string
  accepted_at: string
  receipt: BiometricReceiptMetadata
  autoReturnedDeliveryIds?: string[]
}

/** Repeating the same submission after an uncertain response must retain its idempotency key. */
export async function submitFacialDelivery(submission: FacialSubmission, token?: string | null): Promise<FacialDeliveryResult> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 30000)
  try {
    const headers = token ? {} : await api.getAuthHeaders()
    const response = await fetch("/api/deliveries/facial", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ ...submission, accepted: true, ...(token ? {token} : {}) }),
      signal: controller.signal,
    })
    const result = await response.json().catch(() => null)
    if (!response.ok) throw new Error(result?.error || "O servidor não confirmou o recebimento. Repita a confirmação nesta mesma tela.")
    if (!Array.isArray(result?.deliveryIds) || !result.deliveryIds.length || !result.receipt) throw new Error("Resposta incompleta do servidor. Repita a confirmação nesta mesma tela para consultar a mesma transação.")
    return result as FacialDeliveryResult
  } catch (cause) {
    if (cause instanceof Error && (cause.name === "AbortError" || cause instanceof TypeError)) throw new Error("A conexão terminou sem confirmar o resultado. Repita a confirmação nesta mesma tela; a mesma transação será consultada sem duplicar a entrega.")
    throw cause
  } finally { window.clearTimeout(timeout) }
}
