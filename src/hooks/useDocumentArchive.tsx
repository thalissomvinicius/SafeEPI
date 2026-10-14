"use client"
import { useCallback, useRef, useState } from "react"
import { api, type SignedDocumentArchivePayload } from "@/services/api"

type PendingArchive = { id: string; payload: SignedDocumentArchivePayload; error: string }

/** Memory-only PDF recovery. Never replays delivery creation or inventory writes. */
export function useDocumentArchive() {
  const [pending, setPending] = useState<PendingArchive[]>([])
  const [retrying, setRetrying] = useState<string | null>(null)
  const retryLock = useRef(false)
  const archiveDocument = useCallback(async (payload: SignedDocumentArchivePayload) => {
    try { return await api.archiveSignedDocument(payload) }
    catch (error) {
      setPending(current => [...current, { id: crypto.randomUUID(), payload, error: error instanceof Error ? error.message : "Falha ao arquivar." }])
      throw error
    }
  }, [])
  const retry = async (entry: PendingArchive) => {
    if (retryLock.current) return
    retryLock.current = true
    setRetrying(entry.id)
    try {
      await api.archiveSignedDocument(entry.payload)
      setPending(current => current.filter(item => item.id !== entry.id))
    } catch (error) {
      setPending(current => current.map(item => item.id === entry.id ? { ...item, error: error instanceof Error ? error.message : "Falha ao arquivar." } : item))
    } finally { retryLock.current = false; setRetrying(null) }
  }
  const archiveRecovery = pending.length > 0 ? <section role="alert" className="mx-auto my-4 w-full max-w-2xl space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-left text-sm text-amber-950">
    <h2 className="font-semibold">PDF com arquivamento pendente</h2>
    <p>O registro existente foi preservado. Tentar arquivar novamente não registra outra entrega nem baixa estoque. Baixe o PDF e mantenha esta tela aberta até concluir; a recuperação nesta tela não permanece após recarregar.</p>
    {pending.map(entry => <div key={entry.id} className="space-y-2 border-t border-amber-200 pt-3">
      <p className="break-words font-medium">{entry.payload.fileName}</p><p className="break-words">{entry.error}</p>
      <button type="button" disabled={retrying !== null} onClick={() => void retry(entry)} className="min-h-11 rounded-lg border border-amber-400 bg-white px-4 py-2 font-semibold disabled:opacity-50">{retrying === entry.id ? "Arquivando…" : "Tentar arquivar PDF novamente"}</button>
    </div>)}
  </section> : null
  return { archiveDocument, archiveRecovery }
}
