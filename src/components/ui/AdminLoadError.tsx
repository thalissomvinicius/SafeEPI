import { AlertCircle, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"

export function AdminLoadError({ message, retry, busy = false }: { message: string; retry: () => void; busy?: boolean }) {
  return (
    <div role="alert" className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between">
      <p className="flex min-w-0 items-start gap-2"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{message}</p>
      <Button type="button" variant="outline" onClick={retry} loading={busy} loadingText="Atualizando…" className="shrink-0 border-amber-300 text-amber-900">
        <RefreshCw className="h-4 w-4" aria-hidden="true" /> Tentar novamente
      </Button>
    </div>
  )
}
