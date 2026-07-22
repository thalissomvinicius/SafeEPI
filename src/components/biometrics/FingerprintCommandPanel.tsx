"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { CheckCircle2, Fingerprint, Loader2, Monitor, RefreshCw, ShieldCheck } from "lucide-react"

import { api, type FingerprintEvidence, type FingerprintTerminal } from "@/services/api"

type Props = {
  employeeId: string
  employeeName: string
  operation?: "enroll" | "verify" | "delete"
  onCompleted?: (evidence: FingerprintEvidence) => void
  onReset?: () => void
}

const finalStatuses = new Set(["completed", "failed", "cancelled", "expired"])

export function FingerprintCommandPanel({
  employeeId,
  employeeName,
  operation = "verify",
  onCompleted,
  onReset,
}: Props) {
  const [terminals, setTerminals] = useState<FingerprintTerminal[]>([])
  const [terminalId, setTerminalId] = useState("")
  const [evidence, setEvidence] = useState<FingerprintEvidence | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState("")
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadTerminals = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const rows = await api.getFingerprintTerminals()
      setTerminals(rows)
      const preferred = rows.find((terminal) => terminal.online) || rows[0]
      setTerminalId((current) => rows.some((terminal) => terminal.id === current) ? current : preferred?.id || "")
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Falha ao carregar o terminal.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const loadTimer = setTimeout(() => void loadTerminals(), 0)
    return () => {
      clearTimeout(loadTimer)
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [loadTerminals])

  async function poll(commandId: string) {
    try {
      const next = await api.getFingerprintCommand(commandId)
      setEvidence(next)
      if (!finalStatuses.has(next.status)) {
        timerRef.current = setTimeout(() => void poll(commandId), 1200)
        return
      }
      setRunning(false)
      if (next.status === "completed") {
        onCompleted?.(next)
      } else {
        setError(next.errorCode === "expired"
          ? "O tempo da leitura acabou. Inicie novamente."
          : "A digital não foi confirmada. Confira o dedo e tente outra vez.")
      }
    } catch (pollError) {
      setRunning(false)
      setError(pollError instanceof Error ? pollError.message : "A leitura foi interrompida.")
    }
  }

  const start = async () => {
    if (!terminalId || running) return
    if (timerRef.current) clearTimeout(timerRef.current)
    onReset?.()
    setError("")
    setEvidence(null)
    setRunning(true)
    try {
      const command = await api.createFingerprintCommand({ employeeId, operation, terminalId })
      setEvidence(command)
      timerRef.current = setTimeout(() => void poll(command.id), 500)
    } catch (startError) {
      setRunning(false)
      setError(startError instanceof Error ? startError.message : "Não foi possível iniciar a leitura.")
    }
  }

  const onlineTerminals = terminals.filter((terminal) => terminal.online)
  const actionLabel = operation === "enroll"
    ? "Cadastrar digital"
    : operation === "delete"
      ? "Remover cadastro digital"
      : "Confirmar entrega com o dedo"

  return (
    <div className="space-y-4 rounded-3xl border border-blue-200 bg-gradient-to-br from-blue-50 to-white p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="rounded-2xl bg-blue-600 p-3 text-white shadow-lg shadow-blue-900/10">
          <Fingerprint className="h-6 w-6" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-black uppercase tracking-wide text-slate-900">Leitor de impressão digital</p>
          <p className="mt-1 text-sm font-medium leading-relaxed text-slate-600">
            {operation === "verify"
              ? `${employeeName} deve colocar o dedo indicador direito no leitor fixo.`
              : `Operação protegida para ${employeeName}. O sistema não envia a impressão digital para a nuvem.`}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="sr-only" htmlFor={`fingerprint-terminal-${operation}`}>Terminal biométrico</label>
        <select
          id={`fingerprint-terminal-${operation}`}
          value={terminalId}
          onChange={(event) => setTerminalId(event.target.value)}
          disabled={loading || running}
          className="min-h-[46px] min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none focus:border-blue-500"
        >
          <option value="">Selecione o terminal</option>
          {terminals.map((terminal) => (
            <option key={terminal.id} value={terminal.id} disabled={!terminal.online}>
              {terminal.name} — {terminal.online ? "online" : "offline"}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => void loadTerminals()}
          disabled={loading || running}
          aria-label="Atualizar terminais"
          className="min-h-[46px] rounded-xl border border-slate-200 bg-white px-4 text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw className={`mx-auto h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {onlineTerminals.length === 0 && !loading && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm font-bold text-amber-800">
          <Monitor className="h-4 w-4 shrink-0" /> Abra o aplicativo SafeEPI Leitor no computador do leitor.
        </div>
      )}

      {running && (
        <div className="flex items-center gap-3 rounded-xl border border-blue-200 bg-white px-4 py-4 text-blue-800">
          <Loader2 className="h-5 w-5 animate-spin" />
          <div>
            <p className="text-sm font-black uppercase">Aguardando o dedo</p>
            <p className="text-xs font-medium">Não feche esta tela até a confirmação.</p>
          </div>
        </div>
      )}

      {evidence?.status === "completed" && (
        <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-emerald-800">
          <CheckCircle2 className="h-6 w-6 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-black uppercase">Digital confirmada</p>
            <p className="truncate font-mono text-xs">Evidência {evidence.code}</p>
          </div>
        </div>
      )}

      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</p>}

      <button
        type="button"
        onClick={() => void start()}
        disabled={!terminalId || running || onlineTerminals.length === 0}
        className="flex min-h-[50px] w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-xs font-black uppercase tracking-widest text-white shadow-lg shadow-blue-900/10 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-45"
      >
        {running ? <Loader2 className="h-5 w-5 animate-spin" /> : <ShieldCheck className="h-5 w-5" />}
        {evidence?.status === "completed" ? "Ler novamente" : actionLabel}
      </button>
    </div>
  )
}
