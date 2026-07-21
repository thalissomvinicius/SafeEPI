import { AlertTriangle, RefreshCw } from "lucide-react"
import { cn } from "@/lib/utils"

type DataLoadErrorProps = {
  title?: string
  message?: string
  onRetry?: () => void
  className?: string
}

export function DataLoadError({
  title = "Nao foi possivel consultar os dados",
  message = "A tela nao substituiu os registros por zero. Verifique a conexao e tente novamente.",
  onRetry,
  className,
}: DataLoadErrorProps) {
  return (
    <div className={cn("mx-auto flex min-h-[50vh] w-full max-w-3xl items-center justify-center p-6", className)}>
      <div role="alert" className="w-full rounded-3xl border border-amber-200 bg-white p-8 text-center shadow-sm">
        <AlertTriangle className="mx-auto mb-4 h-10 w-10 text-amber-500" aria-hidden="true" />
        <h1 className="text-xl font-black text-slate-900">{title}</h1>
        <p className="mx-auto mt-2 max-w-xl text-sm font-medium leading-relaxed text-slate-600">{message}</p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mx-auto mt-6 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#2563EB] px-5 py-3 text-xs font-black uppercase tracking-widest text-white transition-colors hover:bg-[#1D4ED8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Tentar novamente
          </button>
        )}
      </div>
    </div>
  )
}
