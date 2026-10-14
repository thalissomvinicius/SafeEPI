export const MANUAL_ACCEPTANCE_VERSION = "epi-receipt-2026-10-14-v1"
export const MANUAL_ACCEPTANCE_TEXT = "Confirmo que sou o colaborador indicado, que conferi os EPIs e as quantidades apresentados nesta entrega e que recebi esses itens. Confirmo o recebimento por assinatura eletrônica, desenhada ou por nome digitado, com foto opcional de apoio."
export type ManualSignatureOrigin = "drawn" | "typed" | "mixed"
export type ManualSignatureDeclaration = {
  origin: ManualSignatureOrigin
  accepted: boolean
  termVersion?: string
}
const declarations = new WeakMap<object, ManualSignatureDeclaration>()
export function setManualSignatureDeclaration(pad: object | null, value: ManualSignatureDeclaration | null) {
  if (!pad) return
  if (value) declarations.set(pad, { ...value })
  else declarations.delete(pad)
}
export function getManualSignatureDeclaration(pad: object | null): ManualSignatureDeclaration | null {
  return pad ? declarations.get(pad) || null : null
}

/** Shape validation only: browser-origin declarations do not prove identity. */
export function parseManualSignatureDeclaration(value: unknown): ManualSignatureDeclaration | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  if (!["drawn", "typed", "mixed"].includes(String(v.origin)) || typeof v.accepted !== "boolean") return null
  if (v.accepted && v.termVersion !== MANUAL_ACCEPTANCE_VERSION) return null
  return { origin: v.origin as ManualSignatureOrigin, accepted: v.accepted, ...(v.accepted ? { termVersion: MANUAL_ACCEPTANCE_VERSION } : {}) }
}
