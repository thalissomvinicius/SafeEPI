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
      <div className={cn("inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-slate-200 bg-white/90 px-4 text-sm font-semibold text-slate-600 shadow-sm shadow-slate-200/70", className)}>
        <span className="relative flex h-5 w-5 items-center justify-center rounded-full bg-blue-50 text-[#2563EB]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        </span>
        <span className="truncate">{label}</span>
      </div>
    )
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "relative isolate flex w-full flex-col items-center justify-center overflow-hidden text-center",
        variant === "page"
          ? "min-h-[60dvh] px-4 py-16"
          : "min-h-64 rounded-[28px] border border-white/80 bg-white/90 px-6 py-12 shadow-[0_24px_70px_rgba(15,23,42,0.08)] ring-1 ring-slate-900/[0.03] backdrop-blur",
        className
      )}
    >
      <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-[#2563EB]/30 to-transparent" />
      <div className="pointer-events-none absolute -top-24 h-48 w-48 rounded-full bg-[#2563EB]/[0.07] blur-3xl" />

      <div className="relative flex h-16 w-16 items-center justify-center rounded-[24px] border border-slate-200/80 bg-white text-[#2563EB] shadow-[0_18px_45px_rgba(37,99,235,0.14)]">
        <span className="absolute inset-0 rounded-[24px] bg-[radial-gradient(circle_at_35%_20%,rgba(37,99,235,0.16),transparent_55%)]" />
        <span className="absolute -inset-2 rounded-[30px] border border-[#2563EB]/10 animate-[safeepi-loader-ring_1.8s_ease-in-out_infinite]" />
        <Loader2 className="relative h-6 w-6 animate-spin" strokeWidth={2.4} />
      </div>
      <p className="mt-5 text-xs font-black uppercase tracking-[0.22em] text-slate-900">{label}</p>
      <p className="mt-1.5 max-w-xs text-sm font-medium leading-relaxed text-slate-500">{detail}</p>

      {showBar && (
        <div className="mt-6 h-2 w-full max-w-64 overflow-hidden rounded-full border border-slate-200/70 bg-slate-100/80 shadow-inner">
          <div className="h-full w-1/2 animate-[safeepi-loading-bar_1.25s_ease-in-out_infinite] rounded-full bg-gradient-to-r from-[#2563EB] via-[#60A5FA] to-[#2563EB] shadow-[0_0_18px_rgba(37,99,235,0.28)]" />
        </div>
      )}
    </div>
  )
}

export function LoadingRows({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-3", className)}>
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="overflow-hidden rounded-2xl border border-slate-100 bg-white/95 p-4 shadow-sm shadow-slate-200/70">
          <div className="flex items-center gap-3">
            <div className="safeepi-loading-sheen h-11 w-11 rounded-2xl bg-slate-100" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="safeepi-loading-sheen h-3 w-2/3 rounded-full bg-slate-200/80" />
              <div className="safeepi-loading-sheen h-3 w-1/2 rounded-full bg-slate-100" />
            </div>
            <div className="safeepi-loading-sheen h-8 w-16 rounded-full bg-slate-100" />
          </div>
        </div>
      ))}
    </div>
  )
}
