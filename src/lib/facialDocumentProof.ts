type SessionReceiptSource = {
  id: string; company_id: string; employee_id: string; remote_link_id: string | null
  decision: string; consumed_at: string | null; delivery_ids: string[] | null
  result: unknown
}
type DocumentScope = { companyId: string; employeeId: string | null; remoteLinkId: string | null; deliveryIds: string[] }

/** This input must be loaded server-side, never from request metadata. */
export function authoritativeFacialReceipt(session: SessionReceiptSource | null, scope: DocumentScope): Record<string, unknown> | null {
  if (!session || session.company_id !== scope.companyId || session.employee_id !== scope.employeeId
    || session.decision !== "approved" || !session.consumed_at
    || (scope.remoteLinkId && scope.remoteLinkId !== session.remote_link_id)) return null
  const ids = new Set(session.delivery_ids || [])
  if (!scope.deliveryIds.length || ids.size !== scope.deliveryIds.length || !scope.deliveryIds.every(id => ids.has(id))) return null
  if (!session.result || typeof session.result !== "object") return null
  const receipt = (session.result as { receipt?: unknown }).receipt
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) return null
  const fields = receipt as Record<string, unknown>
  if (fields.session_id !== session.id || !["accepted_at", "model_id", "calibration_id", "context_hash", "pad_model_id"].every(key => typeof fields[key] === "string" && fields[key])) return null
  return fields
}
