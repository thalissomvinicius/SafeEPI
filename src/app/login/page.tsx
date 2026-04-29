"use client"

import { useEffect, useState } from "react"
import { AlertTriangle, CheckCircle2, Clock3, Loader2, ShieldCheck } from "lucide-react"
import { api } from "@/services/api"
import { useRouter } from "next/navigation"

export default function LoginPage() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState("")
  const [successMsg, setSuccessMsg] = useState("")
  const [redirectCountdown, setRedirectCountdown] = useState(3)
  const router = useRouter()

  useEffect(() => {
    if (!successMsg) return

    if (redirectCountdown <= 0) {
      router.replace("/")
      return
    }

    const timer = window.setTimeout(() => {
      setRedirectCountdown((current) => current - 1)
    }, 1000)

    return () => window.clearTimeout(timer)
  }, [redirectCountdown, router, successMsg])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg("")
    setSuccessMsg("")

    if (!email || !password) {
      setErrorMsg("Preencha todos os campos para continuar.")
      return
    }

    try {
      setLoading(true)
      await api.login(email.trim(), password)
      await api.getCurrentUser()
      setRedirectCountdown(3)
      setSuccessMsg("Login efetuado com sucesso. Preparando seu painel SafeEPI...")
    } catch (err) {
      const error = err as Error
      console.error("Login failed:", error)
      const message = error.message?.toLowerCase().includes("invalid login credentials")
        ? "E-mail ou senha incorretos. Confira os dados e tente novamente."
        : error.message || "Nao foi possivel entrar. Tente novamente."
      setErrorMsg(message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 overflow-y-auto relative py-12 px-4">
      <div className="absolute inset-x-0 top-0 h-px bg-blue-300/30 pointer-events-none" />

      <div className="w-full max-w-md relative z-10 animate-in fade-in zoom-in-95 duration-700">
        <div className="text-center mb-10">
          <div className="mx-auto w-16 h-16 bg-[#2563EB] p-3 rounded-2xl shadow-xl shadow-blue-950/40 mb-6 flex items-center justify-center">
            <ShieldCheck className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-4xl font-black text-white uppercase tracking-tight">
            SafeEPI <span className="text-blue-300">SESMT</span>
          </h1>
          <p className="text-slate-400 text-sm mt-3 font-medium uppercase tracking-[0.2em]">Autenticacao Restrita</p>
        </div>

        <div className="bg-white/5 backdrop-blur-xl border border-white/10 p-6 sm:p-8 rounded-3xl shadow-2xl">
          {successMsg && (
            <div className="mb-6 p-4 bg-emerald-500/10 border border-emerald-400/30 text-emerald-100 rounded-2xl animate-in fade-in slide-in-from-top-2">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-300 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-black uppercase tracking-widest">Acesso liberado</p>
                  <p className="text-xs text-emerald-100/80 font-medium mt-1 leading-relaxed">{successMsg}</p>
                  <div className="mt-3 inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-emerald-200 bg-emerald-950/40 border border-emerald-400/20 rounded-full px-3 py-1.5">
                    <Clock3 className="w-3.5 h-3.5" />
                    Redirecionando em {redirectCountdown}s
                  </div>
                </div>
              </div>
            </div>
          )}

          {errorMsg && (
            <div className="mb-6 p-4 bg-red-500/10 border border-red-400/30 text-red-100 rounded-2xl animate-in fade-in slide-in-from-top-2">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-red-300 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-black uppercase tracking-widest">Acesso nao autorizado</p>
                  <p className="text-xs text-red-100/80 font-medium mt-1 leading-relaxed">{errorMsg}</p>
                </div>
              </div>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-6">
            <div className="space-y-2">
              <label className="block text-[10px] font-black text-slate-300 uppercase tracking-widest">E-mail Corporativo</label>
              <input 
                type="email" 
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading || !!successMsg}
                className="w-full bg-slate-900/50 border border-slate-700 text-white rounded-2xl px-5 py-4 text-sm focus:border-[#2563EB] focus:bg-slate-900 transition-all font-bold placeholder:font-normal placeholder:text-slate-600 outline-none disabled:opacity-70"
                placeholder="nome@empresa.com.br"
                required
              />
            </div>

            <div className="space-y-2">
              <label className="block text-[10px] font-black text-slate-300 uppercase tracking-widest">Senha de Acesso</label>
              <input 
                type="password" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading || !!successMsg}
                className="w-full bg-slate-900/50 border border-slate-700 text-white rounded-2xl px-5 py-4 text-sm focus:border-[#2563EB] focus:bg-slate-900 transition-all font-bold placeholder:font-normal placeholder:text-slate-600 outline-none disabled:opacity-70"
                placeholder="Digite sua senha"
                required
              />
            </div>

            <div className="pt-4">
              <button 
                type="submit" 
                disabled={loading || !!successMsg}
                className="w-full bg-[#2563EB] hover:bg-[#1D4ED8] text-white py-5 rounded-2xl font-black uppercase tracking-[0.2em] transition-all shadow-2xl shadow-blue-950/35 border-b-4 border-blue-900 flex items-center justify-center disabled:opacity-70"
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : successMsg ? "Acesso Confirmado" : "Iniciar Sessao"}
              </button>
            </div>
          </form>

          <div className="mt-8 pt-6 border-t border-white/5 text-center">
            <p className="text-[10px] text-slate-500 uppercase tracking-widest font-black italic">Ambiente Protegido NR-06</p>
          </div>
        </div>
      </div>
    </div>
  )
}
