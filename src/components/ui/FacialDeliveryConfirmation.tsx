"use client"

import { useEffect, useRef, useState } from "react"
import { FaceCamera } from "./FaceCamera"
import { FacialPreflightError, isFacialProofUsable, type FacialContext, type FacialProof } from "./facialClient"

export type FacialSubmission = { session_id: string; context_hash: string; idempotency_key: string }

interface Props {
  employeeId: string
  employeeLabel: string
  context?: FacialContext
  token?: string | null
  items: { name: string; quantity: number; ca?: string }[]
  onConfirm: (submission: FacialSubmission, image: string) => Promise<void>
  onManual: () => void
  onTransactionLocked?: (locked: boolean) => void
}

/** A successful camera check never submits a delivery. The user accepts the specific items separately. */
export function FacialDeliveryConfirmation({employeeId, employeeLabel, context, token, items, onConfirm, onManual, onTransactionLocked}: Props) {
  const fingerprint = JSON.stringify({employeeId, context, token, items})
  return <Confirmation key={fingerprint} employeeId={employeeId} employeeLabel={employeeLabel} context={context} token={token} items={items} onConfirm={onConfirm} onManual={onManual} onTransactionLocked={onTransactionLocked} />
}

function Confirmation({employeeId, employeeLabel, context, token, items, onConfirm, onManual, onTransactionLocked}: Props) {
  const [approved, setApproved] = useState<{proof: FacialProof; image: string; key: string} | null>(null)
  const [accepted, setAccepted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [attempted, setAttempted] = useState(false)
  const [message, setMessage] = useState("")
  const [now, setNow] = useState(Date.now)
  const submitting = useRef(false)
  useEffect(() => {
    if (!approved) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [approved])
  useEffect(() => {
    if (!attempted) return
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = "" }
    window.addEventListener("beforeunload",warnBeforeLeaving)
    return () => window.removeEventListener("beforeunload",warnBeforeLeaving)
  }, [attempted])
  const valid = isFacialProofUsable(approved?.proof ?? null, "same", "same", now)
  async function confirm() {
    if (!approved || !accepted || submitting.current || (!valid && !attempted)) return
    submitting.current = true
    setBusy(true)
    setAttempted(true)
    onTransactionLocked?.(true)
    setMessage("")
    try {
      await onConfirm({session_id: approved.proof.session_id, context_hash: approved.proof.context_hash, idempotency_key: approved.key}, approved.image)
      onTransactionLocked?.(false)
    } catch (cause) {
      if (cause instanceof FacialPreflightError) { setAttempted(false); onTransactionLocked?.(false) }
      setMessage(cause instanceof Error ? cause.message : "Não recebemos a confirmação. Tente novamente nesta mesma tela; a mesma transação será consultada, sem duplicar a entrega.")
    }
    finally { submitting.current = false; setBusy(false) }
  }
  if (!approved) return <FaceCamera mode="verify" verifyEmployeeId={employeeId} verifyToken={token} context={context} employeeLabel={employeeLabel} onCapture={() => {}} onVerified={(proof,image) => {setApproved({proof,image,key:crypto.randomUUID()}); setAccepted(false)}} onCancel={onManual} />
  return <section className="space-y-4 rounded-2xl border border-blue-200 bg-blue-50 p-4 sm:p-6" aria-label="Confirmação de recebimento">
    <h3 className="font-bold text-slate-900">Confira antes de confirmar: {employeeLabel}</h3>
    <p className="text-sm text-slate-700">Verificação recebida. A entrega ainda não foi finalizada.</p>
    <ul className="space-y-2 rounded-xl bg-white p-3 text-sm">{items.map((item,index) => <li key={index} className="flex flex-wrap justify-between gap-2"><span>{item.name}{item.ca ? ` — CA ${item.ca}` : ""}</span><strong>{item.quantity} unidade(s)</strong></li>)}</ul>
    <label className="flex items-start gap-3 text-sm font-medium text-slate-800"><input type="checkbox" checked={accepted} disabled={busy} onChange={event => setAccepted(event.target.checked)} className="mt-0.5 h-5 w-5 shrink-0" />Confirmo que recebi os EPIs e as quantidades relacionados acima.</label>
    {!valid && !attempted && <p role="alert" className="text-sm text-amber-800">A verificação expirou. Verifique o rosto novamente antes de confirmar.</p>}
    {message && <p role="alert" className="text-sm text-red-800">{message}</p>}
    <button type="button" disabled={!accepted || busy || (!valid && !attempted)} onClick={() => void confirm()} className="min-h-12 w-full rounded-xl bg-blue-700 p-3 font-bold text-white disabled:opacity-50">{busy ? "Confirmando no servidor…" : "Confirmar recebimento dos EPIs"}</button>
    {!attempted && <button type="button" disabled={busy} onClick={() => setApproved(null)} className="min-h-11 w-full rounded-xl border border-blue-200 p-2 text-sm">Refazer verificação</button>}
    <button type="button" disabled={busy || attempted} onClick={onManual} className="min-h-11 w-full p-2 text-sm text-slate-700">Usar assinatura manual</button>
    {attempted && <p className="text-xs text-slate-600">Se a conexão falhar, repita a confirmação nesta tela. Não abra outra entrega enquanto o resultado estiver indefinido.</p>}
  </section>
}
