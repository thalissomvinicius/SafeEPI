"use client"

import { useTransition } from "react"
import { AlertTriangle, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import styles from "./page-recovery.module.css"

export function PageRecovery({ retry, digest }: { retry: () => void; digest?: string }) {
  const [pending, startTransition] = useTransition()

  return (
    <section className={styles.shell} aria-labelledby="page-recovery-title">
      <div className={styles.card}>
        <span className={styles.icon}><AlertTriangle size={26} aria-hidden="true" /></span>
        <p className={styles.brand}>SafeEPI</p>
        <h1 id="page-recovery-title">Não foi possível abrir esta tela</h1>
        <p>Tente carregar novamente. Se o erro aconteceu ao salvar uma entrega, confira o histórico antes de repetir a operação.</p>
        <div className={styles.actions}>
          <Button className={styles.retry} loading={pending} loadingText="Carregando…" onClick={() => startTransition(retry)}>
            <RefreshCw size={16} aria-hidden="true" /> Tentar novamente
          </Button>
          <button className={styles.reload} type="button" onClick={() => window.location.reload()}>Recarregar página</button>
        </div>
        {/* A full navigation also recovers when the root router/layout failed. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a className={styles.home} href="/">Voltar ao início</a>
        {digest && <p className={styles.reference}>Referência para suporte: <code>{digest}</code></p>}
      </div>
    </section>
  )
}
