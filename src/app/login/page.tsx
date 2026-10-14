"use client"

import { useEffect, useRef, useState } from "react"
import { AlertCircle, ArrowRight, Check, ClipboardCheck, Eye, EyeOff, FileCheck2, ShieldCheck } from "lucide-react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/contexts/AuthContext"
import { resolvePostLoginRedirect } from "@/lib/authNavigation"

function loginDestination() {
  return resolvePostLoginRedirect(new URLSearchParams(window.location.search).get("redirectTo"))
}

export default function LoginPage() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState("")
  const [success, setSuccess] = useState(false)
  const submittingRef = useRef(false)
  const redirectedRef = useRef(false)
  const router = useRouter()
  const { signIn, user, loading: checkingSession } = useAuth()

  useEffect(() => {
    if (!user || checkingSession || submittingRef.current || redirectedRef.current) return
    redirectedRef.current = true
    router.replace(loginDestination())
    router.refresh()
  }, [checkingSession, router, user])

  const handleLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submittingRef.current) return
    setErrorMsg("")
    if (!email.trim() || !password) {
      setErrorMsg("Preencha o e-mail e a senha para continuar.")
      return
    }

    submittingRef.current = true
    setLoading(true)
    try {
      await signIn(email.trim(), password)
      setSuccess(true)
      redirectedRef.current = true
      router.replace(loginDestination())
      // The login endpoint sets SSR cookies; discard any anonymous route cache.
      router.refresh()
    } catch (error) {
      const message = error instanceof Error ? error.message : "Não foi possível entrar. Tente novamente."
      setErrorMsg(/invalid login credentials|credenciais invalidas/i.test(message)
        ? "E-mail ou senha incorretos. Confira os dados e tente novamente."
        : message)
      setLoading(false)
    } finally {
      submittingRef.current = false
    }
  }

  const disabled = loading || success
  const inputClass = "min-h-14 w-full rounded-xl border border-slate-200 bg-white px-4 text-base text-slate-900 shadow-sm outline-none transition-[border-color,box-shadow] placeholder:text-slate-400 hover:border-slate-300 focus:border-[#2563EB] focus-visible:ring-4 focus-visible:ring-blue-100 disabled:bg-slate-50 disabled:text-slate-500"

  return (
    <div className="grid min-h-[100dvh] w-full bg-white lg:grid-cols-[minmax(0,1.08fr)_minmax(0,1fr)]">
      <aside aria-label="Sobre o SafeEPI" className="relative hidden overflow-hidden bg-slate-900 px-12 py-12 text-white lg:flex lg:flex-col xl:px-20">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_0%_0%,rgba(51,65,85,0.6),transparent_65%)]" />
        <div className="relative flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-xl border border-white/15 bg-white/5"><ShieldCheck strokeWidth={1.7} className="size-6" /></span>
          <span className="text-xl font-semibold tracking-tight">SafeEPI<span className="ml-2 text-xs font-medium uppercase tracking-[0.16em] text-slate-400">Gestão</span></span>
        </div>

        <div className="relative my-auto max-w-lg py-12">
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Do almoxarifado ao prontuário</span>
          <h2 className="mt-5 max-w-md text-4xl font-semibold leading-[1.2] tracking-tight xl:text-[2.75rem]">Cuidado com a equipe.<br /><span className="text-slate-400">Controle em cada entrega.</span></h2>
          <p className="mt-6 max-w-sm text-base leading-relaxed text-slate-300">Entregas, assinaturas e histórico de EPIs em um só lugar. A informação certa para quem cuida da operação.</p>

          <div className="mt-10 border-y border-white/10 py-7">
            <div className="flex items-start gap-4">
              <ClipboardCheck strokeWidth={1.7} className="mt-0.5 size-5 shrink-0 text-slate-400" />
              <div><p className="text-sm font-semibold">Operação organizada</p><p className="mt-1 text-sm leading-relaxed text-slate-400">Colaboradores, equipamentos e estoque conectados.</p></div>
            </div>
            <div className="mt-6 flex items-start gap-4">
              <FileCheck2 strokeWidth={1.7} className="mt-0.5 size-5 shrink-0 text-slate-400" />
              <div><p className="text-sm font-semibold">Histórico que acompanha a equipe</p><p className="mt-1 text-sm leading-relaxed text-slate-400">Consulte comprovantes e prontuários quando precisar.</p></div>
            </div>
          </div>
        </div>
        <p className="relative text-xs leading-relaxed text-slate-400">SafeEPI · Gestão de equipamentos de proteção individual</p>
      </aside>

      <section aria-labelledby="login-title" className="flex min-w-0 flex-col px-6 py-7 sm:px-10 sm:py-10 lg:px-12 xl:px-20">
        <div className="flex items-center gap-2.5 lg:hidden">
          <span className="flex size-10 items-center justify-center rounded-xl bg-slate-900 text-white"><ShieldCheck strokeWidth={1.7} className="size-6" /></span>
          <span className="text-lg font-semibold tracking-tight text-slate-900">SafeEPI</span>
        </div>

        <div className="mx-auto my-auto w-full max-w-[420px] py-10 sm:py-14">
          <div className="mb-8 sm:mb-10">
            <p className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-500">Seu ambiente de trabalho</p>
            <h1 id="login-title" className="mt-3 text-[1.875rem] font-semibold leading-tight tracking-tight text-slate-900 sm:text-4xl">Bem-vindo de volta.</h1>
            <p className="mt-3 text-sm leading-relaxed text-slate-500">Entre com sua conta para continuar a operação.</p>
          </div>

          {errorMsg && (
            <div id="login-error" role="alert" aria-live="assertive" className="mb-6 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm leading-relaxed text-red-800">
              <AlertCircle strokeWidth={1.8} aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <form onSubmit={handleLogin} aria-busy={loading} className="space-y-5">
            <div className="space-y-2">
              <label htmlFor="login-email" className="block text-sm font-medium text-slate-700">E-mail corporativo</label>
              <input id="login-email" name="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} disabled={disabled} className={inputClass} placeholder="nome@empresa.com.br" autoComplete="username" autoCapitalize="none" spellCheck={false} aria-describedby={errorMsg ? "login-error" : undefined} required />
            </div>

            <div className="space-y-2">
              <label htmlFor="login-password" className="block text-sm font-medium text-slate-700">Senha de acesso</label>
              <div className="relative">
                <input id="login-password" name="password" type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} disabled={disabled} className={`${inputClass} pr-14`} placeholder="Sua senha" autoComplete="current-password" aria-describedby={errorMsg ? "login-error" : undefined} required />
                <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => setShowPassword((current) => !current)} disabled={disabled} aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"} aria-pressed={showPassword} className="absolute right-1 top-1 flex size-12 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:opacity-50">
                  {showPassword ? <EyeOff aria-hidden="true" strokeWidth={1.8} className="size-[18px]" /> : <Eye aria-hidden="true" strokeWidth={1.8} className="size-[18px]" />}
                </button>
              </div>
            </div>

            <button type="submit" disabled={disabled} className="mt-2 flex min-h-14 w-full items-center justify-center gap-3 rounded-xl bg-[#2563EB] px-5 text-sm font-semibold text-white shadow-sm transition-[background-color,transform] hover:bg-[#1D4ED8] active:scale-[0.99] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-200 disabled:cursor-wait disabled:opacity-80 motion-reduce:transform-none">
              {success ? <><Check aria-hidden="true" strokeWidth={2} className="size-[18px]" />Acesso confirmado</> : loading ? <><span aria-hidden="true" className="flex gap-1"><span className="size-1 rounded-full bg-white motion-safe:animate-pulse" /><span className="size-1 rounded-full bg-white/70 motion-safe:animate-pulse" /><span className="size-1 rounded-full bg-white/40 motion-safe:animate-pulse" /></span>Validando seu acesso...</> : <>Entrar no SafeEPI<ArrowRight aria-hidden="true" strokeWidth={1.8} className="size-[18px]" /></>}
            </button>
            <p role="status" aria-live="polite" className="sr-only">{success ? "Login efetuado. Abrindo seu painel." : loading ? "Validando sessão e permissões de acesso." : ""}</p>
          </form>

          <div className="mt-8 border-t border-slate-100 pt-5">
            <p className="flex items-start gap-2.5 text-xs leading-relaxed text-slate-500"><ShieldCheck aria-hidden="true" strokeWidth={1.6} className="mt-0.5 size-4 shrink-0" />Acesso exclusivo para usuários autorizados pela empresa.</p>
          </div>
        </div>

        <p className="text-center text-xs text-slate-500">Precisa de acesso? Fale com o administrador da sua empresa.</p>
      </section>
    </div>
  )
}
