"use client"

// ui: câmera/assinatura redesenhada — mobile-first ✓

import { useCallback, useEffect, useRef, useState, type RefObject } from "react"
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
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const [hasSignature, setHasSignature] = useState(false)

  const syncCanvasSize = useCallback(() => {
    const signature = signatureRef.current
    const wrapper = wrapperRef.current
    if (!signature || !wrapper) return

    const canvas = signature.getCanvas()
    const rect = wrapper.getBoundingClientRect()
    const width = Math.max(1, Math.floor(rect.width))
    const height = Math.max(1, Math.floor(rect.height))
    const ratio = Math.min(window.devicePixelRatio || 1, 2)
    const data = signature.isEmpty() ? null : signature.toData()

    canvas.style.width = "100%"
    canvas.style.height = "100%"
    canvas.width = Math.floor(width * ratio)
    canvas.height = Math.floor(height * ratio)
    canvas.getContext("2d")?.scale(ratio, ratio)

    signature.clear()
    if (data) {
      signature.fromData(data)
      setHasSignature(true)
    }
  }, [signatureRef])

  useEffect(() => {
    syncCanvasSize()
    const wrapper = wrapperRef.current
    if (!wrapper || typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", syncCanvasSize)
      return () => window.removeEventListener("resize", syncCanvasSize)
    }

    const observer = new ResizeObserver(() => syncCanvasSize())
    observer.observe(wrapper)
    return () => observer.disconnect()
  }, [syncCanvasSize])

  const clear = () => {
    signatureRef.current?.clear()
    setHasSignature(false)
    onClear?.()
  }

  return (
    <div className={`w-full min-w-0 max-w-full overflow-x-hidden space-y-3 ${className}`}>
      <div className="relative">
        <div
          ref={wrapperRef}
          className={`relative h-[clamp(190px,42dvh,240px)] w-full min-w-0 max-w-full overflow-hidden rounded-2xl border-2 border-dashed bg-white shadow-inner transition sm:h-[280px] ${
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
            canvasProps={{
              className: "block h-full w-full max-w-full touch-none overscroll-contain",
              style: {
                width: "100%",
                height: "100%",
                touchAction: "none",
                WebkitUserSelect: "none",
                userSelect: "none",
              },
            }}
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

      <div className="sticky bottom-0 w-full max-w-full bg-white/95 py-2 backdrop-blur sm:static sm:bg-transparent sm:p-0">
        <button
          type="button"
          onClick={onConfirm}
          disabled={isSaving || !hasSignature}
          className="flex min-h-[52px] w-full min-w-0 items-center justify-center rounded-2xl bg-[#2563EB] px-4 py-4 text-center text-sm font-black uppercase tracking-wider text-white shadow-lg shadow-blue-900/15 transition hover:bg-[#1D4ED8] disabled:bg-slate-300 disabled:shadow-none"
        >
          {isSaving ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <CheckCircle2 className="mr-2 h-5 w-5" />}
          {isSaving ? "Salvando..." : confirmLabel}
        </button>
      </div>
    </div>
  )
}
