"use client"

import { useEffect, useState } from "react"
import { AlertTriangle, CheckCircle2, Clock3, Eye, EyeOff, Loader2 } from "lucide-react"
import { api } from "@/services/api"
import { useRouter } from "next/navigation"

type MascotMode = "idle" | "email" | "password" | "peek" | "loading" | "success" | "error"

function LoginMascot({ mode, gaze }: { mode: MascotMode; gaze: number }) {
  const isEmail = mode === "email"
  const isPeek = mode === "peek"
  const isError = mode === "error"
  const isSuccess = mode === "success"
  const isLoading = mode === "loading"
  const isLocked = mode === "password"
  const scanOffset = isEmail ? Math.max(-18, Math.min(18, gaze * 3)) : 0

  return (
    <div className="relative mx-auto mb-6 flex h-32 w-44 items-center justify-center sm:h-36 sm:w-52">
      <div className={`absolute inset-x-7 top-5 h-24 rounded-full blur-2xl transition-all duration-500 ${isError ? "bg-red-500/20" : isSuccess ? "bg-emerald-400/20" : "bg-blue-500/20"}`} />
      <div className="absolute inset-0 rounded-[2rem] border border-white/10 bg-white/[0.03] shadow-2xl shadow-blue-950/30" />
      <svg
        viewBox="0 0 220 170"
        className={`relative h-full w-full transition-transform duration-300 ${isLoading ? "animate-[premiumFloat_1.8s_ease-in-out_infinite]" : isError ? "animate-[premiumShake_0.35s_ease-in-out_2]" : ""}`}
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="premiumPanel" x1="38" x2="182" y1="16" y2="154">
            <stop offset="0%" stopColor="#172554" />
            <stop offset="54%" stopColor="#08111F" />
            <stop offset="100%" stopColor="#020617" />
          </linearGradient>
          <linearGradient id="premiumHelmet" x1="59" x2="161" y1="40" y2="96">
            <stop offset="0%" stopColor="#93C5FD" />
            <stop offset="42%" stopColor="#2563EB" />
            <stop offset="100%" stopColor="#1D4ED8" />
          </linearGradient>
          <linearGradient id="premiumVisor" x1="76" x2="144" y1="83" y2="118">
            <stop offset="0%" stopColor="#BAE6FD" />
            <stop offset="40%" stopColor="#38BDF8" />
            <stop offset="100%" stopColor="#0F172A" />
          </linearGradient>
          <linearGradient id="premiumGold" x1="76" x2="144" y1="126" y2="154">
            <stop offset="0%" stopColor="#FDBA74" />
            <stop offset="100%" stopColor="#F97316" />
          </linearGradient>
          <filter id="premiumGlow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <rect x="28" y="18" width="164" height="134" rx="34" fill="url(#premiumPanel)" stroke="#1E3A8A" strokeOpacity=".5" />
        <path d="M110 24l56 21v36c0 35-22 61-56 73-34-12-56-38-56-73V45l56-21Z" fill="#020617" opacity=".55" stroke="#60A5FA" strokeOpacity=".3" />
        <path d="M110 36l43 16v29c0 27-16 48-43 59-27-11-43-32-43-59V52l43-16Z" fill="#0B1220" stroke="#2563EB" strokeOpacity=".5" />

        <g opacity=".35">
          <circle cx="110" cy="88" r="58" fill="none" stroke="#60A5FA" strokeDasharray="4 8" />
          <circle cx="110" cy="88" r="42" fill="none" stroke="#F97316" strokeDasharray="2 10" />
        </g>

        <path d="M69 78c2-29 19-45 41-45s39 16 41 45H69Z" fill="url(#premiumHelmet)" />
        <path d="M62 76h96c5 0 9 4 9 9v2H53v-2c0-5 4-9 9-9Z" fill="#1D4ED8" />
        <path d="M104 35h12v40h-12z" fill="#DBEAFE" opacity=".85" />
        <path d="M82 57c7-13 16-20 28-20s21 7 28 20" fill="none" stroke="#DBEAFE" strokeWidth="5" strokeLinecap="round" opacity=".65" />

        <path d="M73 95c4-18 18-29 37-29s33 11 37 29v18c0 16-14 28-37 28s-37-12-37-28V95Z" fill="#E2E8F0" />
        <path d="M82 94c4-12 14-19 28-19s24 7 28 19v12c0 11-11 19-28 19s-28-8-28-19V94Z" fill="url(#premiumVisor)" stroke="#7DD3FC" strokeOpacity=".7" />
        <path d="M88 97h44" stroke="#E0F2FE" strokeWidth="4" strokeLinecap="round" opacity=".65" />

        {(isLocked || isPeek) && (
          <g>
            {isLocked ? (
              <path d="M80 91h60v27c-7 7-17 11-30 11s-23-4-30-11V91Z" fill="#020617" opacity=".92" />
            ) : (
              <>
                <path d="M80 91h23v30c-9-1-17-5-23-10V91Z" fill="#020617" opacity=".9" />
                <path d="M117 91h23v20c-6 5-14 9-23 10V91Z" fill="#020617" opacity=".9" />
                <path d="M106 101h8" stroke="#7DD3FC" strokeWidth="3" strokeLinecap="round" filter="url(#premiumGlow)" />
              </>
            )}
            <path d="M102 104v-6c0-5 3-8 8-8s8 3 8 8v6" fill="none" stroke="#60A5FA" strokeWidth="3" strokeLinecap="round" />
            <rect x="98" y="103" width="24" height="18" rx="6" fill="#2563EB" stroke="#93C5FD" strokeOpacity=".55" />
          </g>
        )}

        {isEmail && (
          <g style={{ transform: `translateX(${scanOffset}px)` }} className="transition-transform duration-300">
            <path d="M110 72v58" stroke="#38BDF8" strokeWidth="2" strokeLinecap="round" filter="url(#premiumGlow)" />
            <circle cx="110" cy="96" r="4" fill="#E0F2FE" filter="url(#premiumGlow)" />
          </g>
        )}

        <path d="M76 143c7-15 19-23 34-23s27 8 34 23H76Z" fill="url(#premiumGold)" opacity=".92" />
        <path d="M96 128h28l-14 13-14-13Z" fill="#EAF2FF" opacity=".95" />

        <g transform="translate(150 113)">
          <rect x="0" y="0" width="29" height="35" rx="9" fill="#F8FAFC" opacity=".96" />
          <path d="M8 12h13M8 19h13M8 26h9" stroke="#2563EB" strokeWidth="3" strokeLinecap="round" />
          <path d="M14.5 4l6 4-6 4-6-4 6-4Z" fill="#F97316" />
        </g>

        {isError && (
          <g transform="translate(150 27)">
            <circle cx="16" cy="16" r="15" fill="#DC2626" />
            <path d="M16 8v10M16 24h.1" stroke="#FFFFFF" strokeWidth="4" strokeLinecap="round" />
          </g>
        )}

        {isSuccess && (
          <g transform="translate(150 27)">
            <circle cx="16" cy="16" r="15" fill="#10B981" />
            <path d="M9 16l5 5 10-12" stroke="#FFFFFF" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </g>
        )}
      </svg>
      <div className="absolute bottom-2 flex items-center gap-2 rounded-full border border-white/10 bg-slate-950/80 px-3 py-1.5 text-[9px] font-black uppercase tracking-widest text-blue-100/80 shadow-lg shadow-slate-950/40">
        <span className={`h-1.5 w-1.5 rounded-full ${isError ? "bg-red-400" : isSuccess ? "bg-emerald-300" : "bg-blue-300"}`} />
        SESMT ID
      </div>
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
        @keyframes premiumShake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-3px); }
          75% { transform: translateX(3px); }
        }

        @keyframes premiumFloat {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-4px); }
        }
      `}</style>

      <div className="w-full max-w-md relative z-10 animate-in fade-in zoom-in-95 duration-700">
        <div className="text-center mb-6 sm:mb-8">
          <LoginMascot mode={mascotMode} gaze={emailGaze} />
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
