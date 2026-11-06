"use client"

import { useEffect, useState } from "react"
import { useAuth } from "@/contexts/AuthContext"
import { Button } from "@/components/ui/button"
import { createPendingDocumentArchive, listPendingDocumentArchives, putPendingDocumentArchive, removePendingDocumentArchive, type PendingDocumentArchive } from "@/lib/documentArchiveQueue"

/** Synthetic, device-local exercise: this component never calls the archival API. */
export function PreviewRecoveryLab() {
  const { user } = useAuth()
  const [state, setState] = useState<{ owner: string; entries: PendingDocumentArchive[] }>({ owner: "", entries: [] })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const entries = state.owner === user?.id ? state.entries : []

  useEffect(() => {
    if (!user?.id) return
    let active = true
    const scope = { userId: user.id, companyId: "preview-lab-synthetic" }
    void listPendingDocumentArchives(scope).then(restored => {
      if (active) setState({ owner: scope.userId, entries: restored })
    }).catch(() => { if (active) setError("O navegador não disponibilizou o armazenamento local. Tente fora do modo privado.") })
    return () => { active = false }
  }, [user?.id])

  const createSample = async () => {
    if (!user?.id || busy) return
    setBusy(true); setError(""); setMessage("")
    const scope = { userId: user.id, companyId: "preview-lab-synthetic" }
    try {
      const { createPdfDocument } = await import("@/utils/pdfDocument")
      const pdf = createPdfDocument()
      pdf.setFontSize(20)
      pdf.text("SafeEPI - Teste de recuperacao", 20, 30)
      pdf.setFontSize(12)
      pdf.text(["DOCUMENTO FICTICIO", "Nenhuma entrega ou assinatura real foi registrada.", "Arquivo salvo apenas neste navegador para o teste."], 20, 50)
      const entry = await createPendingDocumentArchive(scope, { documentType: "delivery", fileName: "SafeEPI_Teste_Ficticio.pdf", pdfBlob: pdf.output("blob"), metadata: { synthetic_preview: true } })
      await putPendingDocumentArchive(entry)
      setState({ owner: scope.userId, entries: await listPendingDocumentArchives(scope) })
      setMessage("PDF fictício salvo neste navegador. Recarregue a página para conferir a recuperação.")
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Não foi possível salvar o teste.") }
    finally { setBusy(false) }
  }

  const finish = async () => {
    if (!user?.id || busy) return
    setBusy(true); setError("")
    const scope = { userId: user.id, companyId: "preview-lab-synthetic" }
    try {
      for (const entry of entries) await removePendingDocumentArchive(scope, entry.id)
      setState({ owner: scope.userId, entries: [] })
      setMessage("Simulação concluída. A cópia fictícia foi removida deste navegador; nenhum documento foi enviado ao banco.")
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Não foi possível concluir a simulação.") }
    finally { setBusy(false) }
  }

  const download = (entry: PendingDocumentArchive) => {
    const url = URL.createObjectURL(entry.payload.pdfBlob)
    const anchor = document.createElement("a")
    anchor.href = url; anchor.download = entry.payload.fileName; anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  return <section className="mx-auto w-full max-w-3xl space-y-6 p-4 md:p-8">
    <div><p className="text-sm font-semibold text-blue-700">Prévia SafeEPI</p><h1 className="mt-1 text-2xl font-bold text-slate-900">Teste de recuperação de PDF</h1><p className="mt-3 text-sm leading-relaxed text-slate-600">Este exercício cria um arquivo fictício apenas neste navegador. Você pode fechar ou recarregar e retornar com a mesma conta para conferir a recuperação. O teste não registra entregas, assinaturas ou movimentos reais.</p></div>
    <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-700"><li>Crie o PDF fictício.</li><li>Recarregue esta página e confira se o arquivo continua abaixo.</li><li>Baixe o PDF para abrir e verificar o conteúdo.</li><li>Conclua a simulação para remover a cópia fictícia.</li></ol>
    <div className="flex flex-wrap gap-3"><Button loading={busy} disabled={!user || entries.length > 0} onClick={() => void createSample()}>Criar PDF fictício</Button><Button variant="outline" onClick={() => window.location.reload()}>Recarregar página</Button></div>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}</p>}
    {message && <p role="status" className="rounded-xl bg-blue-50 p-4 text-sm text-blue-800">{message}</p>}
    <div className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="font-semibold text-slate-900">Arquivos fictícios recuperados: {entries.length}</h2>{entries.map(entry => <div key={entry.id} className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4"><span className="break-all text-sm text-slate-700">{entry.payload.fileName}</span><Button variant="outline" onClick={() => download(entry)}>Baixar PDF fictício</Button></div>)}{entries.length > 0 && <Button className="mt-5" variant="outline" loading={busy} onClick={() => void finish()}>Concluir simulação</Button>}</div>
    <p className="text-xs leading-relaxed text-slate-500">A cópia é local a este navegador e a esta conta. Limpar dados do navegador remove a recuperação. Este exercício verifica o armazenamento local; o reenvio real ao servidor será homologado com banco de testes separado.</p>
  </section>
}
