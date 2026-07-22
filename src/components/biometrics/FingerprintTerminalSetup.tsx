"use client"

import { useEffect, useState } from "react"
import { CheckCircle2, Copy, Fingerprint, Loader2, MonitorUp, RefreshCw, Trash2 } from "lucide-react"

import { useAuth } from "@/contexts/AuthContext"
import { api, type FingerprintTerminal } from "@/services/api"
import { toast } from "@/lib/toast"

export function FingerprintTerminalSetup() {
  const { user } = useAuth()
  const canManage = user?.role === "MASTER" || user?.role === "ADMIN"
  const [name, setName] = useState("Terminal de Digital")
  const [terminals, setTerminals] = useState<FingerprintTerminal[]>([])
  const [pairing, setPairing] = useState<{ code: string; expiresAt: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState("")

  const load = async () => {
    setLoading(true)
    setError("")
    try {
      setTerminals(await api.getFingerprintTerminals())
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Falha ao carregar os terminais.")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0)
    return () => clearTimeout(timer)
  }, [])

  const createPairing = async () => {
    setCreating(true)
    setError("")
    try {
      setPairing(await api.createFingerprintPairing(name.trim()))
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Falha ao gerar o código.")
    } finally {
      setCreating(false)
    }
  }

  const copy = async () => {
    if (!pairing) return
    await navigator.clipboard.writeText(pairing.code)
    toast.success("Código copiado.")
  }

  const revoke = async (terminal: FingerprintTerminal) => {
    if (!window.confirm(`Revogar o acesso do terminal ${terminal.name}?`)) return
    try {
      await api.revokeFingerprintTerminal(terminal.id)
      toast.success("Terminal revogado.")
      await load()
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : "Falha ao revogar o terminal.")
    }
  }

  return (
    <section className="space-y-5 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex items-start gap-3">
        <div className="rounded-2xl bg-blue-600 p-3 text-white"><Fingerprint className="h-6 w-6" /></div>
        <div>
          <h2 className="text-lg font-black uppercase tracking-tight text-slate-900">Aplicativo SafeEPI Leitor</h2>
          <p className="mt-1 text-sm leading-relaxed text-slate-600">Pareie o computador fixo uma única vez. A impressão digital permanece protegida no banco privado do Windows.</p>
        </div>
      </div>

      {canManage && (
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} className="min-h-[46px] rounded-xl border border-slate-200 px-4 text-sm font-bold outline-none focus:border-blue-500" placeholder="Nome do terminal" />
          <button type="button" onClick={() => void createPairing()} disabled={creating || name.trim().length < 2} className="min-h-[46px] rounded-xl bg-blue-600 px-5 text-xs font-black uppercase tracking-widest text-white disabled:opacity-50">
            {creating ? <Loader2 className="mx-auto h-5 w-5 animate-spin" /> : "Gerar código"}
          </button>
        </div>
      )}

      {pairing && (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5 text-center">
          <p className="text-xs font-black uppercase tracking-widest text-blue-700">Digite este código no aplicativo Windows</p>
          <button type="button" onClick={() => void copy()} className="mt-3 inline-flex items-center gap-3 rounded-xl bg-white px-5 py-3 font-mono text-2xl font-black tracking-[0.18em] text-slate-900 shadow-sm">
            {pairing.code} <Copy className="h-4 w-4 text-blue-600" />
          </button>
          <p className="mt-3 text-xs font-bold text-slate-500">Válido até {new Date(pairing.expiresAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</p>
        </div>
      )}

      <div className="flex items-center justify-between border-t border-slate-100 pt-4">
        <p className="text-xs font-black uppercase tracking-widest text-slate-500">Terminais vinculados</p>
        <button type="button" onClick={() => void load()} disabled={loading} aria-label="Atualizar" className="rounded-lg p-2 text-slate-500 hover:bg-slate-50"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /></button>
      </div>
      <div className="space-y-2">
        {terminals.map((terminal) => (
          <div key={terminal.id} className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
            {terminal.online ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <MonitorUp className="h-5 w-5 text-slate-400" />}
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-black text-slate-800">{terminal.name}</p><p className="truncate text-xs text-slate-500">{terminal.device_description || "Leitor Windows"}</p></div>
            <span className={`text-[10px] font-black uppercase ${terminal.online ? "text-emerald-600" : "text-slate-400"}`}>{terminal.online ? "Online" : "Offline"}</span>
            {canManage && <button type="button" onClick={() => void revoke(terminal)} aria-label={`Revogar ${terminal.name}`} className="rounded-lg p-2 text-slate-400 transition hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>}
          </div>
        ))}
        {!loading && terminals.length === 0 && <p className="rounded-xl bg-slate-50 px-4 py-4 text-sm font-medium text-slate-500">Nenhum terminal pareado ainda.</p>}
      </div>
      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</p>}
    </section>
  )
}
