"use client"

import { Download, ExternalLink, FileText, X } from "lucide-react"
import { useId, useRef } from "react"
import { createPortal } from "react-dom"
import { useDialogAccessibility } from "@/hooks/useDialogAccessibility"
import { useVisualViewport } from "@/hooks/useVisualViewport"

type PdfActionDialogProps = {
  description?: string
  fileName: string
  onClose: () => void
  onDownload?: () => void
  onPreview?: () => void
  title: string
  url: string
}

export function PdfActionDialog({
  description,
  fileName,
  onClose,
  onDownload,
  onPreview,
  title,
  url,
}: PdfActionDialogProps) {
  const dialogRef = useDialogAccessibility<HTMLDivElement>(true, onClose)
  const overlayRef = useRef<HTMLDivElement | null>(null)
  useVisualViewport(overlayRef)
  const titleId = useId()
  const descriptionId = useId()

  if (typeof document === "undefined") return null
  return createPortal(
    <div
      ref={overlayRef}
      className="safeepi-viewport-overlay fixed inset-x-0 z-[120] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        className="safeepi-panel-enter safeepi-sheet-panel w-full max-w-md overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-[0_24px_80px_rgb(15_23_42/18%)]"
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-5">
          <div className="min-w-0">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-[var(--brand-tint)] px-2.5 py-1 text-xs font-medium text-[#2563EB]">
              <FileText className="h-3.5 w-3.5" />
              PDF pronto
            </div>
            <h2 id={titleId} className="text-xl font-semibold tracking-tight text-slate-800">{title}</h2>
            <p className="mt-2 break-all font-mono text-[11px] text-slate-400">{fileName}</p>
          </div>
          <button
            aria-label="Fechar"
            className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-600"
            onClick={onClose}
            type="button"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-5 px-6 py-6">
          <p id={descriptionId} className="text-sm font-medium leading-relaxed text-slate-500">
            {description || "Escolha se deseja apenas visualizar o PDF em uma nova aba ou baixá-lo agora."}
          </p>

          <div className="grid gap-3">
            <a
              className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
              href={url}
              onClick={onPreview}
              rel="noopener noreferrer"
              target="_blank"
            >
              <ExternalLink className="h-4 w-4 text-[#2563EB]" />
              Visualizar em nova aba
            </a>

            <a
              className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#2563EB] px-5 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#1D4ED8]"
              download={fileName}
              href={url}
              onClick={onDownload}
            >
              <Download className="h-4 w-4" />
              Baixar PDF
            </a>
          </div>
        </div>
      </div>
    </div>, document.body,
  )
}
