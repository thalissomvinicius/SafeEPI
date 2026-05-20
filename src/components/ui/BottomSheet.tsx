// responsive: revisado — mobile-first ✓
"use client"

import { ReactNode } from "react"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"

type BottomSheetProps = {
  open: boolean
  title?: string
  description?: string
  children: ReactNode
  onClose: () => void
  className?: string
  contentClassName?: string
  closeLabel?: string
  desktop?: "dialog" | "sheet"
}

export function BottomSheet({
  open,
  title,
  description,
  children,
  onClose,
  className,
  contentClassName,
  closeLabel = "Fechar",
  desktop = "dialog",
}: BottomSheetProps) {
  if (!open) return null

  const desktopLayout = desktop === "sheet"
    ? "md:items-stretch md:justify-end"
    : "md:items-center md:justify-center md:p-4"

  const desktopPanel = desktop === "sheet"
    ? "md:h-full md:max-h-full md:max-w-xl md:rounded-none md:rounded-l-3xl"
    : "md:max-h-[calc(100dvh-2rem)] md:rounded-3xl"

  return (
    <div
      className={cn("fixed inset-0 z-50 flex items-end justify-center bg-slate-900/60 p-0 backdrop-blur-sm animate-in fade-in duration-200", desktopLayout)}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title || closeLabel}
        className={cn(
          "flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-3xl border border-slate-200 bg-white shadow-2xl animate-in slide-in-from-bottom-8 duration-200 md:zoom-in-95",
          desktopPanel,
          className,
        )}
      >
        {(title || description) && (
          <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-100 p-5 md:p-6">
            <div className="min-w-0">
              {title && <h2 className="break-words text-lg font-black uppercase tracking-tight text-slate-900">{title}</h2>}
              {description && <p className="mt-1 text-sm font-medium text-slate-500">{description}</p>}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-400 transition-all hover:bg-slate-50 hover:text-slate-700"
              aria-label={closeLabel}
              title={closeLabel}
            >
              <X className="h-5 w-5" />
            </button>
          </header>
        )}
        <div className={cn("min-h-0 flex-1 overflow-y-auto p-5 md:p-6", contentClassName)}>
          {children}
        </div>
      </section>
    </div>
  )
}
