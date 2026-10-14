"use client"

import { useCallback, useEffect, useId, useRef, useState, type RefObject } from "react"
import { createPortal } from "react-dom"
import SignatureCanvas from "react-signature-canvas"
import { CheckCircle2, Expand, Loader2, RotateCcw, X } from "lucide-react"
import { useDialogAccessibility } from "@/hooks/useDialogAccessibility"
import { useVisualViewport } from "@/hooks/useVisualViewport"
import { MANUAL_ACCEPTANCE_TEXT, MANUAL_ACCEPTANCE_VERSION, setManualSignatureDeclaration, type ManualSignatureOrigin } from "@/lib/manualSignatureEvidence"

type SignatureCaptureProps = {
  signatureRef: RefObject<SignatureCanvas | null>
  onConfirm: () => void
  onClear?: () => void
  isSaving?: boolean
  confirmLabel?: string
  className?: string
  compact?: boolean
  showConfirmButton?: boolean
  onSignatureChange?: (hasSignature: boolean) => void
  requireAcceptance?: boolean
  acceptanceContext?: string
}

function copyCanvas(canvas: HTMLCanvasElement) {
  const copy = document.createElement("canvas")
  copy.width = canvas.width
  copy.height = canvas.height
  copy.getContext("2d")?.drawImage(canvas, 0, 0)
  return copy
}

export function SignatureCapture({ signatureRef, onConfirm, onClear, isSaving = false, confirmLabel = "Confirmar assinatura", className = "", compact = false, showConfirmButton = true, onSignatureChange, requireAcceptance = false, acceptanceContext }: SignatureCaptureProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const expandButtonRef = useRef<HTMLButtonElement | null>(null)
  const snapshotRef = useRef<HTMLCanvasElement | null>(null)
  const drawingRef = useRef(false)
  const [hasSignature, setHasSignature] = useState(false)
  const [typedSignature, setTypedSignature] = useState("")
  const [acceptedContext, setAcceptedContext] = useState<string | null>(null)
  const [previousContext, setPreviousContext] = useState(acceptanceContext)
  // Invalidate permanently on context changes, including changing back to old items.
  if (previousContext !== acceptanceContext) {
    setPreviousContext(acceptanceContext)
    if (acceptedContext !== null) setAcceptedContext(null)
  }
  const accepted = acceptedContext === (acceptanceContext ?? "default")
  const setAccepted = (value: boolean) => setAcceptedContext(value ? acceptanceContext ?? "default" : null)
  const [expanded, setExpanded] = useState(false)
  const originRef = useRef<ManualSignatureOrigin | null>(null)
  useEffect(() => {
    setManualSignatureDeclaration(signatureRef.current, originRef.current ? { origin: originRef.current, accepted: requireAcceptance && accepted, ...(requireAcceptance && accepted ? { termVersion: MANUAL_ACCEPTANCE_VERSION } : {}) } : null)
  }, [accepted, hasSignature, expanded, requireAcceptance, signatureRef])
  const [portal, setPortal] = useState<HTMLElement | null>(null)
  useEffect(() => { onSignatureChange?.(hasSignature) }, [hasSignature, onSignatureChange])
  const typedSignatureId = useId()
  const headingId = useId()
  const closeExpanded = useCallback(() => { if (!isSaving) setExpanded(false) }, [isSaving])
  const restoreInlineFocus = useCallback(() => expandButtonRef.current?.focus(), [])
  const dialogRef = useDialogAccessibility<HTMLDivElement>(expanded, closeExpanded)
  useVisualViewport(dialogRef, expanded)

  const syncCanvasSize = useCallback(() => {
    const signature = signatureRef.current
    const wrapper = wrapperRef.current
    if (!signature || !wrapper || drawingRef.current) return
    const canvas = signature.getCanvas()
    const rect = canvas.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    const width = Math.floor(rect.width), height = Math.floor(rect.height)
    const ratio = Math.max(1, Math.min(window.devicePixelRatio || 1, 2))
    const targetWidth = Math.floor(width * ratio), targetHeight = Math.floor(height * ratio)
    if (canvas.width === targetWidth && canvas.height === targetHeight && (!snapshotRef.current || !signature.isEmpty())) return
    // Resize preserves the bitmap, including typed signatures absent from
    // SignaturePad.toData(). Do not clear the pad's nonempty state on resize.
    canvas.width = targetWidth
    canvas.height = targetHeight
    const context = canvas.getContext("2d")
    context?.scale(ratio, ratio)
    const snapshot = snapshotRef.current
    if (snapshot) {
      const scale = Math.min(width / snapshot.width, height / snapshot.height)
      const imageWidth = snapshot.width * scale, imageHeight = snapshot.height * scale
      context?.drawImage(snapshot, (width - imageWidth) / 2, (height - imageHeight) / 2, imageWidth, imageHeight)
      // Portal transitions mount a fresh pad; rehydrate its public state.
      if (signature.isEmpty()) signature.fromDataURL(canvas.toDataURL("image/png"), { ratio, width, height })
    }
  }, [signatureRef])

  useEffect(() => {
    syncCanvasSize()
    const wrapper = wrapperRef.current
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(syncCanvasSize) : null
    if (wrapper) observer?.observe(wrapper)
    window.addEventListener("resize", syncCanvasSize)
    return () => { observer?.disconnect(); window.removeEventListener("resize", syncCanvasSize) }
  }, [syncCanvasSize, expanded])

  useEffect(() => {
    if (!expanded || !portal) return
    const siblings = Array.from(document.body.children).filter((node): node is HTMLElement => node instanceof HTMLElement && node !== portal)
    const previous = siblings.map(node => node.inert)
    siblings.forEach(node => { node.inert = true })
    return () => {
      siblings.forEach((node, index) => { node.inert = previous[index] })
      portal.remove()
      queueMicrotask(restoreInlineFocus)
    }
  }, [expanded, portal, restoreInlineFocus])

  const openExpanded = () => {
    if (isSaving) return
    const host = document.createElement("div")
    host.dataset.signatureScreen = "true"
    document.body.appendChild(host)
    setPortal(host)
    setExpanded(true)
  }
  const clear = () => {
    originRef.current = null
    setAccepted(false)
    setManualSignatureDeclaration(signatureRef.current, null)
    signatureRef.current?.clear()
    snapshotRef.current = null
    setHasSignature(false)
    onClear?.()
  }
  const applyTypedSignature = () => {
    const signature = signatureRef.current
    const name = typedSignature.trim().replace(/\s+/g, " ")
    if (!signature || name.length < 3) return
    originRef.current = "typed"
    setAccepted(false)
    setManualSignatureDeclaration(signature, { origin: "typed", accepted: false })
    const canvas = signature.getCanvas()
    const source = document.createElement("canvas")
    source.width = canvas.width
    source.height = canvas.height
    const context = source.getContext("2d")
    if (!context) return
    context.fillStyle = "#0f172a"
    context.font = `italic ${Math.min(source.height * 0.32, 96)}px "Segoe Script", "Brush Script MT", cursive`
    context.textAlign = "center"
    context.textBaseline = "middle"
    context.fillText(name.slice(0, 100), source.width / 2, source.height / 2, source.width * 0.88)
    const ratio = Math.max(1, Math.min(window.devicePixelRatio || 1, 2))
    signature.clear()
    signature.fromDataURL(source.toDataURL("image/png"), { ratio, width: canvas.width / ratio, height: canvas.height / ratio })
    canvas.getContext("2d")?.drawImage(source, 0, 0, canvas.width / ratio, canvas.height / ratio)
    snapshotRef.current = source
    setHasSignature(true)
  }

  const editor = <div className={`flex w-full min-w-0 flex-col gap-3 ${expanded ? "min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6" : className}`}>
    <div className="flex items-center justify-between gap-3">
      <p className="text-sm font-medium text-slate-600">{compact ? "Assinatura" : "Desenhe sua assinatura"}</p>
      <div className="flex gap-1">
        {!expanded && <button ref={expandButtonRef} type="button" onClick={openExpanded} disabled={isSaving} className="flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-600"><Expand className="h-4 w-4" aria-hidden="true" />Tela inteira</button>}
        <button type="button" onClick={clear} disabled={isSaving} className="flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-semibold text-slate-600 hover:bg-slate-50" aria-label="Limpar assinatura"><RotateCcw className="h-4 w-4" aria-hidden="true" />{!compact && <span className="hidden sm:inline">Limpar</span>}</button>
      </div>
    </div>
    <div ref={wrapperRef} data-signature-canvas className={`relative w-full shrink-0 overflow-hidden rounded-xl border-2 border-dashed bg-white ${expanded ? "h-[min(42dvh,360px)] min-h-[160px]" : compact ? "h-[140px] sm:h-[180px]" : "h-[220px] sm:h-[280px]"} ${hasSignature ? "border-emerald-400" : "border-slate-300"}`}>
      {!hasSignature && <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-4 text-center"><p className="text-sm text-slate-400">Assine aqui com o dedo ou mouse</p></div>}
      <SignatureCanvas ref={signatureRef} clearOnResize={false} penColor="#0f172a"
        onBegin={() => { drawingRef.current = true; originRef.current = originRef.current === "typed" || originRef.current === "mixed" ? "mixed" : "drawn"; setAccepted(false); setManualSignatureDeclaration(signatureRef.current, { origin: originRef.current, accepted: false }); setHasSignature(true) }}
        onEnd={() => {
          drawingRef.current = false
          const signature = signatureRef.current
          if (signature && !signature.isEmpty()) snapshotRef.current = copyCanvas(signature.getCanvas())
          setHasSignature(Boolean(signature && !signature.isEmpty()))
          syncCanvasSize()
        }}
        canvasProps={{ className: "block h-full w-full touch-none", "aria-label": "Área para desenhar a assinatura. Alternativa por digitação abaixo.", "aria-disabled": isSaving, style: { width: "100%", height: "100%", touchAction: "none", WebkitUserSelect: "none", userSelect: "none", pointerEvents: isSaving ? "none" : "auto" } }} />
    </div>
    <details className="rounded-xl border border-slate-200 bg-slate-50">
      <summary className="flex min-h-11 cursor-pointer items-center px-4 py-3 text-sm font-semibold text-slate-700">Não consegue desenhar? Digite seu nome</summary>
      <div className="space-y-3 px-4 pb-4">
        <label htmlFor={typedSignatureId} className="block text-sm text-slate-600">Seu nome será aplicado visualmente à assinatura.</label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input id={typedSignatureId} type="text" autoComplete="name" maxLength={100} value={typedSignature} onChange={event => setTypedSignature(event.target.value)} disabled={isSaving} className="min-h-11 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 text-base text-slate-900" placeholder="Nome completo" />
          <button type="button" onClick={applyTypedSignature} disabled={typedSignature.trim().length < 3 || isSaving} className="min-h-11 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 disabled:opacity-50">Aplicar assinatura</button>
        </div>
      </div>
    </details>
    {requireAcceptance && <section className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm leading-relaxed text-slate-700">
      <p>{MANUAL_ACCEPTANCE_TEXT}</p>
      <label className="mt-3 flex min-h-11 cursor-pointer items-start gap-3"><input type="checkbox" checked={accepted} disabled={isSaving || !hasSignature} onChange={event => setAccepted(event.target.checked)} className="mt-1 h-5 w-5 shrink-0" /><span>Li e confirmo o recebimento dos itens apresentados.</span></label>
    </section>}
    {(showConfirmButton || expanded) && <button type="button" onClick={() => {
      if (requireAcceptance && !accepted) return
      setManualSignatureDeclaration(signatureRef.current, originRef.current ? { origin: originRef.current, accepted: requireAcceptance && accepted, ...(requireAcceptance && accepted ? { termVersion: MANUAL_ACCEPTANCE_VERSION } : {}) } : null)
      onConfirm()
    }} disabled={isSaving || !hasSignature || (requireAcceptance && !accepted)} className="flex min-h-[52px] w-full shrink-0 items-center justify-center rounded-xl bg-[#2563EB] px-4 py-3 text-center text-sm font-semibold text-white transition-colors hover:bg-[#1D4ED8] disabled:bg-slate-300 disabled:shadow-none">
      {isSaving ? <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="mr-2 h-5 w-5" aria-hidden="true" />}{isSaving ? "Salvando…" : confirmLabel}
    </button>}
    {expanded && <p className="pb-[env(safe-area-inset-bottom)] text-center text-xs text-slate-500">Ao voltar, sua assinatura será preservada.</p>}
  </div>

  return expanded && portal ? <>
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">Assinatura aberta em tela inteira.</div>
    {createPortal(<div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={headingId} tabIndex={-1} className="safeepi-viewport-overlay fixed inset-x-0 z-[10000] flex min-h-0 flex-col overflow-hidden bg-white outline-none">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <h2 id={headingId} className="text-lg font-semibold text-slate-900">Assinatura</h2>
        <button type="button" onClick={closeExpanded} disabled={isSaving} className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-slate-600" aria-label="Voltar à tela anterior"><X className="h-5 w-5" aria-hidden="true" /></button>
      </header>{editor}
    </div>, portal)}
  </> : editor
}
