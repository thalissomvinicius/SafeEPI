"use client"

import { useEffect, useRef, useState } from "react"
import { AlertCircle, ArrowRight, Check, ClipboardCheck, Eye, EyeOff, HardHat, LockKeyhole, Mail, PenLine, ShieldCheck } from "lucide-react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/contexts/AuthContext"
import { resolvePostLoginRedirect } from "@/lib/authNavigation"
import { useVisualViewport } from "@/hooks/useVisualViewport"
import styles from "./login.module.css"

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
  const viewportRef = useRef<HTMLDivElement | null>(null)
  useVisualViewport(viewportRef)
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
  return (
    <div ref={viewportRef} className={styles.viewport}>
      <aside aria-label="Sobre o SafeEPI" className={styles.brandPanel}>
        <div className={styles.brandHeader}>
          <div className={styles.wordmark}><span className={styles.brandIcon}><HardHat aria-hidden="true" strokeWidth={1.7} /></span><span>Safe<span className={styles.brandAccent}>EPI</span></span></div>
          <span className={styles.brandLabel}>Gestão de EPIs</span>
        </div>
        <div className={styles.brandContent}>
          <span className={styles.eyebrow}>Cuidado que se transforma em controle</span>
          <h2>Proteção para a equipe.<br /><span>Clareza para a gestão.</span></h2>
          <p className={styles.brandDescription}>Cada equipamento, cada entrega e cada assinatura. Tudo conectado à rotina da sua empresa.</p>
          <div className={styles.workflow}>
            <p className={styles.workflowTitle}>Da entrega ao histórico</p>
            <div className={styles.workflowStep}><span><HardHat aria-hidden="true" strokeWidth={1.7} /></span><div><strong>Entregue com controle</strong><p>Equipamentos e estoque organizados.</p></div></div>
            <div className={styles.workflowStep}><span><PenLine aria-hidden="true" strokeWidth={1.7} /></span><div><strong>Registre o recebimento</strong><p>Assinaturas vinculadas à entrega.</p></div></div>
            <div className={styles.workflowStep}><span><ClipboardCheck aria-hidden="true" strokeWidth={1.7} /></span><div><strong>Consulte quando precisar</strong><p>O histórico acompanha cada colaborador.</p></div></div>
          </div>
        </div>
        <p className={styles.brandFooter}><span />Mais organização. Mais cuidado com as pessoas.</p>
      </aside>
      <section aria-labelledby="login-title" className={styles.loginPanel}>
        <div className={styles.mobileBrand}><span className={styles.brandIcon}><HardHat aria-hidden="true" strokeWidth={1.7} /></span><span>Safe<span className={styles.brandAccent}>EPI</span></span><span className={styles.mobileBrandLabel}>Gestão de EPIs</span></div>
        <div className={styles.formContainer}>
          <div className={styles.formIntro}>
            <span className={styles.accessIcon}><LockKeyhole aria-hidden="true" strokeWidth={1.7} /></span>
            <p className={styles.formEyebrow}>Seu ambiente de trabalho</p>
            <h1 id="login-title">Bem-vindo de volta.</h1>
            <p className={styles.formDescription}>Entre com sua conta e continue de onde parou.</p>
          </div>
          {errorMsg && (
            <div id="login-error" role="alert" aria-live="assertive" className={styles.error}>
              <AlertCircle strokeWidth={1.8} aria-hidden="true" />
              <span title={errorMsg}>{errorMsg}</span>
            </div>
          )}
          <form onSubmit={handleLogin} aria-busy={loading} className={styles.form}>
            <div className={styles.field}>
              <label htmlFor="login-email">E-mail corporativo</label>
              <div className={styles.inputWrapper}><Mail aria-hidden="true" strokeWidth={1.7} className={styles.inputIcon} /><input id="login-email" name="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} disabled={disabled} className={styles.input} placeholder="nome@empresa.com.br" autoComplete="username" autoCapitalize="none" spellCheck={false} enterKeyHint="next" aria-describedby={errorMsg ? "login-error" : undefined} required /></div>
            </div>
            <div className={styles.field}>
              <label htmlFor="login-password">Senha de acesso</label>
              <div className={styles.inputWrapper}>
                <LockKeyhole aria-hidden="true" strokeWidth={1.7} className={styles.inputIcon} />
                <input id="login-password" name="password" type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} disabled={disabled} className={`${styles.input} ${styles.passwordInput}`} placeholder="Sua senha" autoComplete="current-password" enterKeyHint="go" aria-describedby={errorMsg ? "login-error" : undefined} required />
                <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => setShowPassword((current) => !current)} disabled={disabled} aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"} aria-pressed={showPassword} className={styles.passwordToggle}>
                  {showPassword ? <EyeOff aria-hidden="true" strokeWidth={1.8} className="size-[18px]" /> : <Eye aria-hidden="true" strokeWidth={1.8} className="size-[18px]" />}
                </button>
              </div>
            </div>
            <button type="submit" disabled={disabled} className={styles.submit}>
              {success ? <><Check aria-hidden="true" strokeWidth={2} className="size-[18px]" />Acesso confirmado</> : loading ? <><span aria-hidden="true" className="flex gap-1"><span className="size-1 rounded-full bg-white motion-safe:animate-pulse" /><span className="size-1 rounded-full bg-white/70 motion-safe:animate-pulse" /><span className="size-1 rounded-full bg-white/40 motion-safe:animate-pulse" /></span>Validando seu acesso...</> : <>Entrar no SafeEPI<ArrowRight aria-hidden="true" strokeWidth={1.8} className="size-[18px]" /></>}
            </button>
            <p role="status" aria-live="polite" className="sr-only">{success ? "Login efetuado. Abrindo seu painel." : loading ? "Validando sessão e permissões de acesso." : ""}</p>
          </form>

          <p className={styles.accessNote}><ShieldCheck aria-hidden="true" strokeWidth={1.7} />Acesso exclusivo para usuários da sua empresa.</p>
        </div>
        <p className={styles.help}>Precisa de acesso? <span>Fale com o administrador da sua empresa.</span></p>
      </section>
    </div>
  )
}
