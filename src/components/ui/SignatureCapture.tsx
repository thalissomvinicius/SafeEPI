"use client"

// ui: câmera/assinatura redesenhada — mobile-first ✓

import { useState, type RefObject } from "react"
import SignatureCanvas from "react-signature-canvas"
import { CheckCircle2, Loader2, RotateCcw } from "lucide-react"

type SignatureCaptureProps = {
  signatureRef: RefObject<SignatureCanvas | null>
  onConfirm: () => void
  onClear?: () => void
  isSaving?: boolean
  confirmLabel?: string
  className?: string
}

export function SignatureCapture({
  signatureRef,
  onConfirm,
  onClear,
  isSaving = false,
  confirmLabel = "Confirmar assinatura",
  className = "",
}: SignatureCaptureProps) {
  const [hasSignature, setHasSignature] = useState(false)

  const clear = () => {
    signatureRef.current?.clear()
    setHasSignature(false)
    onClear?.()
  }

  return (
    <div className={`space-y-3 ${className}`}>
      <div className="relative">
        <div
          className={`relative h-[200px] w-full overflow-hidden rounded-2xl border-2 border-dashed bg-white shadow-inner transition sm:h-[280px] ${
            hasSignature ? "border-emerald-400 ring-4 ring-emerald-50" : "border-[#2563EB]/45"
          }`}
        >
          {!hasSignature && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-4 text-center">
              <p className="text-sm font-semibold text-slate-400">Assine aqui com o dedo</p>
            </div>
          )}
          <SignatureCanvas
            ref={signatureRef}
            onBegin={() => setHasSignature(true)}
            onEnd={() => setHasSignature(!signatureRef.current?.isEmpty())}
            canvasProps={{ className: "h-full w-full touch-none" }}
            penColor="#0f172a"
          />
        </div>
        <button
          type="button"
          onClick={clear}
          className="absolute right-2 top-2 flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl bg-white/95 px-3 text-xs font-black uppercase tracking-widest text-slate-600 shadow-sm ring-1 ring-slate-200 transition hover:bg-slate-50"
          aria-label="Limpar assinatura"
        >
          <RotateCcw className="h-4 w-4 sm:mr-1" />
          <span className="hidden sm:inline">Limpar</span>
        </button>
      </div>

      <div className="sticky bottom-0 -mx-1 bg-white/95 px-1 py-2 backdrop-blur sm:static sm:bg-transparent sm:p-0">
        <button
          type="button"
          onClick={onConfirm}
          disabled={isSaving || !hasSignature}
          className="flex min-h-[52px] w-full items-center justify-center rounded-2xl bg-[#2563EB] px-5 py-4 text-sm font-black uppercase tracking-[0.14em] text-white shadow-lg shadow-blue-900/15 transition hover:bg-[#1D4ED8] disabled:bg-slate-300 disabled:shadow-none"
        >
          {isSaving ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <CheckCircle2 className="mr-2 h-5 w-5" />}
          {isSaving ? "Salvando..." : confirmLabel}
        </button>
      </div>
    </div>
  )
}
