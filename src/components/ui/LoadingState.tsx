import { cn } from "@/lib/utils"
import { LoadingIndicator } from "@/components/ui/loading-indicator"

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
      <div role="status" aria-live="polite" className={cn("inline-flex min-h-11 max-w-full items-center justify-center gap-2 rounded-full border border-border bg-background px-4 text-sm font-medium text-muted-foreground", className)}>
        <LoadingIndicator className="text-primary" />
        <span className="truncate">{label}</span>
      </div>
    )
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex w-full min-w-0 flex-col items-center justify-center text-center",
        variant === "page"
          ? "min-h-[60dvh] px-4 py-16"
          : "min-h-64 rounded-2xl border border-border bg-card px-6 py-10 shadow-sm",
        className
      )}
    >
      <div className="flex size-12 items-center justify-center rounded-xl border border-border bg-background text-2xl text-primary">
        <LoadingIndicator />
      </div>
      <p className="mt-4 text-balance text-sm font-semibold text-foreground">{label}</p>
      <p className="mt-1.5 max-w-xs text-pretty text-sm leading-relaxed text-muted-foreground">{detail}</p>

      {showBar && (
        <div data-slot="loading-bar" aria-hidden="true" className="mt-5 h-1 w-full max-w-40 overflow-hidden rounded-full bg-muted">
          <div className="mx-auto h-full w-1/3 rounded-full bg-primary/30" />
        </div>
      )}
    </div>
  )
}

export function LoadingRows({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div aria-hidden="true" className={cn("space-y-3", className)}>
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="overflow-hidden rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="size-11 shrink-0 rounded-xl bg-muted" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-3 w-2/3 rounded-full bg-muted" />
              <div className="h-3 w-1/2 rounded-full bg-muted/60" />
            </div>
            <div className="h-8 w-16 shrink-0 rounded-lg bg-muted" />
          </div>
        </div>
      ))}
    </div>
  )
}
