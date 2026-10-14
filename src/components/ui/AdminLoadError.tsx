import { AlertCircle, RefreshCw } from "lucide-react"

export function AdminLoadError({ message, retry, busy = false }: { message: string; retry: () => void; busy?: boolean }) {
  return (
    <div role="alert" className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between">
      <p className="flex min-w-0 items-start gap-2"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{message}</p>
      <button type="button" onClick={retry} disabled={busy} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-amber-300 bg-white px-3 font-semibold disabled:opacity-50">
        <RefreshCw className="h-4 w-4" aria-hidden="true" /> Tentar novamente
      </button>
    </div>
  )
}
