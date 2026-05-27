import { Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

type LoadingStateProps = {
  label?: string
  detail?: string
  variant?: "page" | "panel" | "inline"
  className?: string
  showBar?: boolean
}

export function LoadingState({
  label = "Carregando dados",
  detail = "Sincronizando com a base SafeEPI...",
  variant = "panel",
  className,
  showBar = true,
}: LoadingStateProps) {
  if (variant === "inline") {
    return (
      <div className={cn("flex min-h-11 items-center justify-center gap-2 text-sm font-bold text-slate-500", className)}>
        <Loader2 className="h-4 w-4 animate-spin text-[#2563EB]" />
        <span>{label}</span>
      </div>
    )
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex w-full flex-col items-center justify-center text-center",
        variant === "page" ? "min-h-[60dvh] px-4 py-16" : "min-h-64 rounded-3xl border border-slate-200 bg-white px-6 py-12 shadow-sm",
        className
      )}
    >
      <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-[#2563EB] ring-1 ring-blue-100">
        <div className="absolute inset-0 rounded-2xl bg-[#2563EB]/10 blur-xl" />
        <Loader2 className="relative h-6 w-6 animate-spin" />
      </div>
      <p className="mt-4 text-xs font-black uppercase tracking-[0.2em] text-slate-800">{label}</p>
      <p className="mt-1 max-w-xs text-sm font-medium leading-relaxed text-slate-500">{detail}</p>

      {showBar && (
        <div className="mt-5 h-1.5 w-full max-w-56 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full w-1/2 animate-[safeepi-loading-bar_1.2s_ease-in-out_infinite] rounded-full bg-[#2563EB]" />
        </div>
      )}
    </div>
  )
}

export function LoadingRows({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-3", className)}>
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 animate-pulse rounded-2xl bg-slate-100" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-3 w-2/3 animate-pulse rounded-full bg-slate-200/80" />
              <div className="h-3 w-1/2 animate-pulse rounded-full bg-slate-100" />
            </div>
            <div className="h-8 w-16 animate-pulse rounded-full bg-slate-100" />
          </div>
        </div>
      ))}
    </div>
  )
}
