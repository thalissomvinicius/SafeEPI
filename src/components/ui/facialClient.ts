export type FacialProof = { session_id: string; context_hash: string; expires_at: string }
/** Local validation ended before any receipt request was sent. */
export class FacialPreflightError extends Error {}
export type FacialEnrollment = { enrollment_id: string; status: "approved" | "pending"; model_id: string; photo_url?: string | null }
export type FacialContext = {
  employee_id: string
  workplace_id: string | null
  third_party_id: string | null
  delivery_date: string
  items: { ppe_id: string; quantity: number; reason: string }[]
}

export function normalizeFacialDecision(value: unknown): "approved" | "rejected" | "unavailable" {
  if (!value || typeof value !== "object") return "unavailable"
  const result = value as Record<string, unknown>
  if (result.decision === "rejected") return "rejected"
  return result.decision === "approved" && typeof result.session_id === "string" && !!result.session_id
    && typeof result.context_hash === "string" && !!result.context_hash
    && typeof result.expires_at === "string" && Number.isFinite(Date.parse(result.expires_at))
    ? "approved" : "unavailable"
}

export function isFacialProofUsable(proof: FacialProof | null, capturedContext: string, currentContext: string, now = Date.now()) {
  return !!proof && capturedContext === currentContext && !!proof.session_id && !!proof.context_hash && Date.parse(proof.expires_at) > now
}

export function cameraErrorMessage(error: unknown) {
  const name = error && typeof error === "object" && "name" in error ? String(error.name) : ""
  if (name === "NotAllowedError" || name === "SecurityError") return "Autorize a permissão da câmera nas configurações deste site e tente novamente. Você também pode usar assinatura manual."
  if (name === "NotFoundError") return "Nenhuma câmera disponível. Conecte uma webcam ou use assinatura manual."
  if (name === "NotReadableError") return "A câmera está ocupada por outro aplicativo. Feche-o e tente novamente."
  return error instanceof Error ? error.message : "Não foi possível abrir a câmera. Tente novamente ou use assinatura manual."
}
