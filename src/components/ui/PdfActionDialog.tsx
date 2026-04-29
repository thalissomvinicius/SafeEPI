"use client"

import { Download, ExternalLink, FileText, X } from "lucide-react"

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
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white shadow-2xl animate-in zoom-in-95 duration-200 overflow-hidden">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-5">
          <div className="min-w-0">
            <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-red-50 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-[#8B1A1A]">
              <FileText className="h-3.5 w-3.5" />
              PDF pronto
            </div>
            <h2 className="text-xl font-black uppercase tracking-tighter text-slate-800">{title}</h2>
            <p className="mt-2 break-all text-xs font-medium text-slate-400">{fileName}</p>
          </div>
          <button
            aria-label="Fechar"
            className="rounded-xl p-2 text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-600"
            onClick={onClose}
            type="button"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-5 px-6 py-6">
          <p className="text-sm font-medium leading-relaxed text-slate-500">
            {description || "Escolha se deseja apenas visualizar o PDF em uma nova aba ou baixá-lo agora."}
          </p>

          <div className="grid gap-3">
            <a
              className="flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-4 text-xs font-black uppercase tracking-widest text-slate-700 transition-all hover:bg-slate-50"
              href={url}
              onClick={onPreview}
              rel="noopener noreferrer"
              target="_blank"
            >
              <ExternalLink className="h-4 w-4 text-[#8B1A1A]" />
              Visualizar em nova aba
            </a>

            <a
              className="flex items-center justify-center gap-2 rounded-2xl bg-[#8B1A1A] px-5 py-4 text-xs font-black uppercase tracking-widest text-white shadow-lg shadow-red-900/15 transition-all hover:bg-[#681313]"
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
    </div>
  )
}
