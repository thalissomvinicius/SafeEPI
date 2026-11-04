"use client"

import Link from "next/link"
import { isPreviewReadOnly } from "@/lib/previewEnvironment"

export function PreviewBanner({ floating = false }: { floating?: boolean }) {
  if (!isPreviewReadOnly()) return null
  return (
    <aside aria-label="Ambiente de testes" className={`${floating ? "fixed inset-x-0 top-0 z-50" : "shrink-0"} border-b border-amber-200 bg-amber-50 px-3 py-2 text-center text-xs leading-relaxed text-amber-950`}>
      <strong>Versão de testes · somente consulta.</strong>{" "}
      A prévia usa os dados atuais. Entregas, cadastros, exclusões e envios estão bloqueados até conectarmos um banco de testes separado.
      {" "}<Link href="/preview-lab" className="font-semibold underline underline-offset-2">Testar recuperação com PDF fictício</Link>
    </aside>
  )
}
