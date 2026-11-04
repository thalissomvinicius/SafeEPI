"use client"

import Link from "next/link"
import { isPreviewReadOnly } from "@/lib/previewEnvironment"
import { cn } from "@/lib/utils"
import styles from "./PreviewBanner.module.css"

export function PreviewBanner({ floating = false, atViewportTop = floating }: { floating?: boolean; atViewportTop?: boolean }) {
  if (!isPreviewReadOnly()) return null
  return (
    <aside aria-label="Ambiente de testes" className={cn("border-b border-amber-200 bg-amber-50 px-3 py-2 text-center text-xs leading-relaxed text-amber-950", floating ? "fixed inset-x-0 top-0 z-50" : "shrink-0", atViewportTop && "pt-[max(0.5rem,env(safe-area-inset-top))] pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))]")}>
      <strong>Versão de testes · somente consulta.</strong>{" "}
      <span className={styles.explanation}>A prévia usa os dados atuais. Entregas, cadastros, exclusões e envios estão bloqueados até conectarmos um banco de testes separado.</span>
      {" "}<Link href="/preview-lab" className="font-semibold underline underline-offset-2">Testar recuperação com PDF fictício</Link>
    </aside>
  )
}
