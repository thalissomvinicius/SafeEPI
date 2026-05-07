"use client"

import { useEffect, useState } from "react"
import { AlertTriangle, CheckCircle2, Clock3, Eye, EyeOff, Loader2, ShieldCheck } from "lucide-react"
import { api } from "@/services/api"
import { useRouter } from "next/navigation"

type MascotMode = "idle" | "email" | "password" | "peek" | "loading" | "success" | "error"

function LoginMascot({ mode, gaze }: { mode: MascotMode; gaze: number }) {
  const isPassword = mode === "password"
  const isPeek = mode === "peek"
  const isError = mode === "error"
  const isSuccess = mode === "success"
  const isLoading = mode === "loading"
  const eyeOffset = mode === "email" ? Math.max(-5, Math.min(5, gaze)) : 0
  const eyeY = isError ? 1.5 : isSuccess ? -1 : 0

  return (
    <div className="relative mx-auto mb-5 flex h-32 w-32 items-center justify-center sm:h-36 sm:w-36">
      <div className={`absolute inset-5 rounded-full bg-blue-500/10 blur-xl transition-all duration-300 ${isError ? "bg-red-500/20" : isSuccess ? "bg-emerald-400/20" : ""}`} />
      <svg viewBox="0 0 160 160" className={`relative h-full w-full drop-shadow-2xl transition-transform duration-300 ${isLoading ? "animate-pulse" : isError ? "animate-[wiggle_0.35s_ease-in-out_2]" : ""}`} aria-hidden="true">
        <defs>
          <linearGradient id="helmetGradient" x1="34" x2="126" y1="24" y2="92">
            <stop offset="0%" stopColor="#60A5FA" />
            <stop offset="100%" stopColor="#2563EB" />
          </linearGradient>
          <linearGradient id="vestGradient" x1="47" x2="113" y1="104" y2="154">
            <stop offset="0%" stopColor="#1E293B" />
            <stop offset="100%" stopColor="#0F172A" />
          </linearGradient>
        </defs>

        <path d="M44 151c4-29 19-44 36-44s32 15 36 44H44Z" fill="url(#vestGradient)" />
        <path d="M62 112h36l-18 21-18-21Z" fill="#EAF2FF" />
        <path d="M69 112h22l-11 13-11-13Z" fill="#BFDBFE" />
        <path d="M51 151c2-16 7-27 14-34l15 17 15-17c7 7 12 18 14 34H51Z" fill="#2563EB" />
        <path d="M73 132h14l4 19H69l4-19Z" fill="#F97316" />

        <circle cx="80" cy="76" r="36" fill="#F1C9A5" />
        <path d="M44 75c0 24 15 41 36 41s36-17 36-41c-6 7-18 10-36 10s-30-3-36-10Z" fill="#E9B98F" opacity=".35" />
        <path d="M45 68c2-27 17-43 35-43s33 16 35 43H45Z" fill="url(#helmetGradient)" />
        <path d="M39 69h82c4 0 7 3 7 7v1H32v-1c0-4 3-7 7-7Z" fill="#1D4ED8" />
        <path d="M75 26h10v42H75z" fill="#DBEAFE" opacity=".8" />
        <path d="M56 48c6-13 14-20 24-20S98 35 104 48" fill="none" stroke="#DBEAFE" strokeWidth="5" strokeLinecap="round" opacity=".65" />

        <g className="transition-transform duration-300" style={{ transform: `translate(${eyeOffset}px, ${eyeY}px)` }}>
          <ellipse cx="67" cy="78" rx={isError ? 3.5 : 4.5} ry={isSuccess ? 2.2 : 5} fill="#0F172A" />
          <ellipse cx="93" cy="78" rx={isError ? 3.5 : 4.5} ry={isSuccess ? 2.2 : 5} fill="#0F172A" />
          {!isPassword && (
            <>
              <circle cx="68.5" cy="76" r="1.2" fill="#FFFFFF" />
              <circle cx="94.5" cy="76" r="1.2" fill="#FFFFFF" />
            </>
          )}
        </g>

        <path d={isError ? "M68 99c7-5 17-5 24 0" : isSuccess ? "M66 96c7 8 21 8 28 0" : "M70 98c6 4 14 4 20 0"} fill="none" stroke="#8B4E2F" strokeWidth="4" strokeLinecap="round" />
        <path d="M56 67c6-4 13-4 18-1M86 66c6-3 13-2 18 1" stroke="#7C3F23" strokeWidth="3" strokeLinecap="round" fill="none" opacity=".65" />

        {(isPassword || isPeek) && (
          <g className="transition-all duration-300">
            <g style={{ transform: isPeek ? "translate(-7px, -3px) rotate(-7deg)" : "translate(0, 0)" }}>
              <path d="M22 104c13-17 28-25 45-25 6 0 9 7 5 12-8 9-18 16-31 23-9 5-17-2-19-10Z" fill="#F1C9A5" />
              <path d="M44 83c8-4 16-5 24-3" stroke="#DCA77F" strokeWidth="4" strokeLinecap="round" />
              <path d="M46 94c7-3 14-4 21-3" stroke="#DCA77F" strokeWidth="4" strokeLinecap="round" />
            </g>
            <g style={{ transform: isPeek ? "translate(7px, -3px) rotate(7deg)" : "translate(0, 0)" }}>
              <path d="M138 104c-13-17-28-25-45-25-6 0-9 7-5 12 8 9 18 16 31 23 9 5 17-2 19-10Z" fill="#F1C9A5" />
              <path d="M116 83c-8-4-16-5-24-3" stroke="#DCA77F" strokeWidth="4" strokeLinecap="round" />
              <path d="M114 94c-7-3-14-4-21-3" stroke="#DCA77F" strokeWidth="4" strokeLinecap="round" />
            </g>
          </g>
        )}

        <g transform="translate(108 106)">
          <rect x="0" y="0" width="30" height="36" rx="8" fill="#FFFFFF" opacity=".95" />
          <path d="M8 12h14M8 19h14M8 26h10" stroke="#2563EB" strokeWidth="3" strokeLinecap="round" />
          <path d="M15 4l6 4-6 4-6-4 6-4Z" fill="#F97316" />
        </g>

        {isSuccess && (
          <g transform="translate(103 28)">
            <circle cx="16" cy="16" r="15" fill="#10B981" />
            <path d="M9 16l5 5 10-12" stroke="#FFFFFF" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </g>
        )}
      </svg>
    </div>
  )
}

export default function LoginPage() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [focusedField, setFocusedField] = useState<"email" | "password" | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState("")
  const [successMsg, setSuccessMsg] = useState("")
  const [redirectCountdown, setRedirectCountdown] = useState(3)
  const router = useRouter()

  const mascotMode: MascotMode = successMsg
    ? "success"
    : loading
      ? "loading"
      : errorMsg
        ? "error"
        : focusedField === "password"
          ? showPassword
            ? "peek"
            : "password"
          : focusedField === "email"
            ? "email"
            : "idle"

  const emailGaze = email.length === 0 ? -4 : Math.min(5, -4 + email.length * 0.45)

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
    <div className="min-h-[100dvh] flex items-center justify-center bg-slate-950 overflow-y-auto relative px-4 py-8 sm:py-12">
      <div className="absolute inset-x-0 top-0 h-px bg-blue-300/30 pointer-events-none" />
      <style jsx global>{`
        @keyframes wiggle {
          0%, 100% { transform: rotate(0deg); }
          25% { transform: rotate(-2deg); }
          75% { transform: rotate(2deg); }
        }
      `}</style>

      <div className="w-full max-w-md relative z-10 animate-in fade-in zoom-in-95 duration-700">
        <div className="text-center mb-6 sm:mb-8">
          <LoginMascot mode={mascotMode} gaze={emailGaze} />
          <div className="mx-auto w-12 h-12 sm:w-14 sm:h-14 bg-[#2563EB] p-3 rounded-2xl shadow-xl shadow-blue-950/40 mb-5 sm:mb-6 flex items-center justify-center">
            <ShieldCheck className="w-8 h-8 sm:w-10 sm:h-10 text-white" />
          </div>
          <h1 className="text-3xl sm:text-4xl font-black text-white uppercase tracking-tight">
            SafeEPI <span className="text-blue-300">SESMT</span>
          </h1>
          <p className="text-slate-400 text-xs sm:text-sm mt-3 font-medium uppercase tracking-[0.18em] sm:tracking-[0.2em]">Autenticacao Restrita</p>
        </div>

        <div className="bg-white/5 backdrop-blur-xl border border-white/10 p-5 sm:p-8 rounded-2xl sm:rounded-3xl shadow-2xl">
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
            <div className="mb-6 p-4 bg-red-500/10 border border-red-400/30 text-blue-100 rounded-2xl animate-in fade-in slide-in-from-top-2">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-red-300 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-black uppercase tracking-widest">Acesso nao autorizado</p>
                  <p className="text-xs text-blue-100/80 font-medium mt-1 leading-relaxed">{errorMsg}</p>
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
                onFocus={() => setFocusedField("email")}
                onBlur={() => setFocusedField(null)}
                disabled={loading || !!successMsg}
                className="w-full bg-slate-900/50 border border-slate-700 text-white rounded-xl sm:rounded-2xl px-4 sm:px-5 py-4 text-base sm:text-sm focus:border-[#2563EB] focus:bg-slate-900 transition-all font-bold placeholder:font-normal placeholder:text-slate-600 outline-none disabled:opacity-70"
                placeholder="nome@empresa.com.br"
                autoComplete="email"
                required
              />
            </div>

            <div className="space-y-2">
              <label className="block text-[10px] font-black text-slate-300 uppercase tracking-widest">Senha de Acesso</label>
              <div className="relative">
                <input 
                  type={showPassword ? "text" : "password"} 
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onFocus={() => setFocusedField("password")}
                  onBlur={() => setFocusedField(null)}
                  disabled={loading || !!successMsg}
                  className="w-full bg-slate-900/50 border border-slate-700 text-white rounded-xl sm:rounded-2xl py-4 pl-4 pr-14 text-base sm:pl-5 sm:text-sm focus:border-[#2563EB] focus:bg-slate-900 transition-all font-bold placeholder:font-normal placeholder:text-slate-600 outline-none disabled:opacity-70"
                  placeholder="Digite sua senha"
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => setShowPassword((current) => !current)}
                  disabled={loading || !!successMsg}
                  aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-xl border border-slate-700/80 bg-slate-950/60 p-2 text-slate-400 transition-all hover:border-blue-400 hover:text-blue-200 disabled:opacity-50"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="pt-4">
              <button 
                type="submit" 
                disabled={loading || !!successMsg}
                className="w-full bg-[#2563EB] hover:bg-[#1D4ED8] text-white py-4 sm:py-5 rounded-xl sm:rounded-2xl font-black uppercase tracking-[0.16em] sm:tracking-[0.2em] transition-all shadow-2xl shadow-blue-950/35 shadow-lg shadow-blue-900/15 flex items-center justify-center disabled:opacity-70"
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
