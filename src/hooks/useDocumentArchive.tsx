"use client"
import { useCallback, useEffect, useRef, useState } from "react"
import { useAuth } from "@/contexts/AuthContext"
import { api, type SignedDocumentArchivePayload } from "@/services/api"
import {
  archiveScopeKey, createPendingDocumentArchive, listPendingDocumentArchives,
  putPendingDocumentArchive, removePendingDocumentArchive,
  type ArchiveScope, type PendingDocumentArchive,
} from "@/lib/documentArchiveQueue"
import { Button } from "@/components/ui/button"

type PendingArchive = PendingDocumentArchive & { persisted: boolean }
type QueueState = { scopeKey: string; entries: PendingArchive[]; warning?: string }
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "Falha ao arquivar."

/** Device-local recovery; it never creates deliveries or changes inventory. */
export function useDocumentArchive() {
  const { user } = useAuth()
  const companyId = user?.role === "MASTER" ? api.getMasterCompanyContext() : user?.company_id
  // Public links are memory-only even when the browser also has an operator session.
  // Their URL belongs only to this hook's ephemeral scope and never to IndexedDB.
  const remoteLocation = typeof window !== "undefined" && /^\/(?:delivery\/remote|training\/remote|capture)(?:\/|$)/.test(window.location.pathname)
    ? `${window.location.pathname}${window.location.search}${window.location.hash}` : null
  const scope = !remoteLocation && user?.id && companyId ? { userId: user.id, companyId } : null
  const scopeKey = remoteLocation
    ? JSON.stringify(["remote", user?.id || null, companyId || null, remoteLocation])
    : scope ? archiveScopeKey(scope) : JSON.stringify([user?.id || null, null])
  const [queue, setQueue] = useState<QueueState>({ scopeKey: "", entries: [] })
  const [busy, setBusy] = useState<string[]>([])
  const [refresh, setRefresh] = useState(0)
  const inFlight = useRef(new Set<string>())
  const completed = useRef(new Set<string>())
  const currentScope = useRef(scopeKey)
  useEffect(() => { currentScope.current = scopeKey }, [scopeKey])

  useEffect(() => {
    const refreshContext = () => setRefresh(value => value + 1)
    window.addEventListener("storage", refreshContext)
    window.addEventListener("safeepi:brand-changed", refreshContext)
    window.addEventListener("popstate", refreshContext)
    return () => {
      window.removeEventListener("storage", refreshContext)
      window.removeEventListener("safeepi:brand-changed", refreshContext)
      window.removeEventListener("popstate", refreshContext)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    if (!scope) return
    const expected = scope
    void (async () => {
      try {
        const actual = await api.getArchiveContext()
        if (archiveScopeKey(actual) !== archiveScopeKey(expected)) return
        const restored = await listPendingDocumentArchives(expected)
        if (cancelled) return
        setQueue(previous => {
          const entries = new Map(restored.filter(entry => !completed.current.has(entry.id)).map(entry => [entry.id, { ...entry, persisted: true }]))
          if (previous.scopeKey === scopeKey) previous.entries.forEach(entry => entries.set(entry.id, entry))
          return { scopeKey, entries: [...entries.values()] }
        })
      } catch (error) {
        if (!cancelled) setQueue(previous => ({ scopeKey, entries: previous.scopeKey === scopeKey ? previous.entries : [], warning: errorMessage(error) }))
      }
    })()
    return () => { cancelled = true }
    // Primitive scope key tracks identity and company without reloading per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey, refresh])

  const keepEntry = useCallback((key: string, entry: PendingArchive, warning?: string) => {
    setQueue(previous => ({
      scopeKey: key,
      entries: [...(previous.scopeKey === key ? previous.entries.filter(item => item.id !== entry.id) : []), entry],
      warning: warning || (previous.scopeKey === key ? previous.warning : undefined),
    }))
  }, [])

  const attempt = useCallback(async (entry: PendingArchive, expectedScope: ArchiveScope | null) => {
    if (inFlight.current.has(entry.id)) throw new Error("Este PDF já está sendo arquivado. Aguarde a confirmação.")
    inFlight.current.add(entry.id)
    setBusy([...inFlight.current])
    try {
      if (currentScope.current !== entry.scopeKey) throw new Error("A conta ou empresa mudou. Retorne ao contexto original para arquivar este PDF.")
      if (expectedScope) {
        const actual = await api.getArchiveContext()
        if (archiveScopeKey(actual) !== entry.scopeKey || currentScope.current !== entry.scopeKey) {
          throw new Error("A conta ou empresa mudou. Retorne ao contexto original para arquivar este PDF.")
        }
      }
      const document = await api.archiveSignedDocument(entry.payload)
      if (entry.persisted && expectedScope) {
        try { await removePendingDocumentArchive(expectedScope, entry.id) }
        catch {
          keepEntry(entry.scopeKey, { ...entry, error: "PDF arquivado no servidor. A cópia local ainda não pôde ser removida; uma nova tentativa conferirá o mesmo arquivo." })
          return document
        }
      }
      completed.current.add(entry.id)
      setQueue(previous => previous.scopeKey === entry.scopeKey ? { ...previous, entries: previous.entries.filter(item => item.id !== entry.id) } : previous)
      return document
    } catch (error) {
      const updated = { ...entry, error: errorMessage(error) }
      if (entry.persisted) {
        try { await putPendingDocumentArchive(updated) } catch { /* Original durable bytes remain queued. */ }
      }
      if (currentScope.current === entry.scopeKey) keepEntry(entry.scopeKey, updated)
      throw error
    } finally {
      inFlight.current.delete(entry.id)
      setBusy([...inFlight.current])
    }
  }, [keepEntry])

  const archiveDocument = useCallback(async (payload: SignedDocumentArchivePayload) => {
    const expectedScope = !payload.linkToken && scope ? scope : null
    const key = expectedScope ? archiveScopeKey(expectedScope) : scopeKey
    let entry: PendingArchive
    let warning: string | undefined
    if (expectedScope) {
      const actual = await api.getArchiveContext()
      if (archiveScopeKey(actual) !== key) throw new Error("A conta ou empresa mudou. Reabra a tela no contexto correto.")
      try {
        const durableEntry = await createPendingDocumentArchive(expectedScope, payload)
        entry = { ...durableEntry, persisted: false }
        try { await putPendingDocumentArchive(durableEntry); entry.persisted = true }
        catch (error) { warning = errorMessage(error) }
      } catch (error) {
        warning = errorMessage(error)
        entry = { id: crypto.randomUUID(), scopeKey: key, ...expectedScope, createdAt: Date.now(), payload: { ...payload, expectedUserId: expectedScope.userId, expectedCompanyId: expectedScope.companyId }, error: "Arquivamento ainda não confirmado.", persisted: false }
      }
    } else {
      // Public remote links contain a bearer credential and never enter IndexedDB.
      entry = { id: crypto.randomUUID(), scopeKey: key, userId: "", companyId: "", createdAt: Date.now(), payload, error: "Arquivamento ainda não confirmado.", persisted: false }
    }
    if (currentScope.current === key) keepEntry(key, entry, warning)
    return attempt(entry, expectedScope)
    // The primitive scope key captures the current account and company.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey, attempt, keepEntry])

  const pending = queue.scopeKey === scopeKey ? queue.entries : []
  const warning = queue.scopeKey === scopeKey ? queue.warning : undefined
  const download = (entry: PendingArchive) => {
    const url = URL.createObjectURL(entry.payload.pdfBlob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = entry.payload.fileName
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }
  const archiveRecovery = pending.length > 0 || warning ? <section role="alert" className="mx-auto my-4 w-full max-w-2xl space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-left text-sm text-amber-950">
    <h2 className="font-semibold">{pending.length ? "PDF com arquivamento pendente" : "Recuperação local de PDFs indisponível"}</h2>
    {warning && <p>{warning}</p>}
    {pending.some(entry => entry.persisted) && <p>As cópias pendentes ficam neste navegador, para esta conta e empresa. Você pode retomar após recarregar. Limpar os dados do navegador ou trocar de dispositivo remove esse acesso à recuperação local.</p>}
    {pending.some(entry => !entry.persisted) && <p>Há uma cópia disponível apenas nesta tela. Baixe o PDF e mantenha a página aberta até arquivar; esta cópia não será recuperada após fechar ou recarregar.</p>}
    {pending.length > 0 && <p>Tentar arquivar novamente envia o mesmo PDF e não registra outra entrega nem baixa estoque.</p>}
    {pending.map(entry => <div key={entry.id} className="space-y-2 border-t border-amber-200 pt-3">
      <p className="break-words font-medium">{entry.payload.fileName}</p><p className="break-words">{entry.error}</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={() => download(entry)}>Baixar PDF pendente</Button>
        <Button type="button" disabled={busy.length > 0} loading={busy.includes(entry.id)} loadingText="Arquivando…" onClick={() => void attempt(entry, entry.userId ? { userId: entry.userId, companyId: entry.companyId } : null).catch(() => {})}>Tentar arquivar PDF novamente</Button>
      </div>
    </div>)}
  </section> : null
  return { archiveDocument, archiveRecovery }
}
