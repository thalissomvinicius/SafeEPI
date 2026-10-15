"use client"

import { PageRecovery } from "@/components/ui/PageRecovery"

export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="pt-BR">
      <head><title>Não foi possível abrir a tela · SafeEPI</title></head>
      <body style={{ margin: 0 }}><PageRecovery retry={retry} digest={error.digest} /></body>
    </html>
  )
}
