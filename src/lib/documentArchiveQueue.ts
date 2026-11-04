import type { SignedDocumentArchivePayload } from "@/services/api"

export type ArchiveScope = { userId: string; companyId: string }
export type PendingDocumentArchive = {
  id: string
  scopeKey: string
  userId: string
  companyId: string
  createdAt: number
  payload: SignedDocumentArchivePayload
  error: string
}

const DATABASE = "safeepi-document-archive-v1"
const STORE = "pending"

export function archiveScopeKey(scope: ArchiveScope) {
  return JSON.stringify([scope.userId, scope.companyId])
}

async function readBlob(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === "function") return blob.arrayBuffer()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(new Error("Não foi possível ler o PDF para recuperação."))
    reader.readAsArrayBuffer(blob)
  })
}

export async function createPendingDocumentArchive(scope: ArchiveScope, payload: SignedDocumentArchivePayload): Promise<PendingDocumentArchive> {
  if (payload.linkToken) throw new Error("Links de assinatura não são armazenados na recuperação local.")
  const digest = await crypto.subtle.digest("SHA-256", await readBlob(payload.pdfBlob))
  const hash = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("")
  const scopeKey = archiveScopeKey(scope)
  const links = [...new Set([payload.deliveryId, ...(payload.deliveryIds || [])].filter(Boolean))].sort()
  return {
    id: JSON.stringify([scopeKey, payload.documentType, payload.employeeId || null, payload.trainingId || null, links, hash]),
    scopeKey,
    ...scope,
    createdAt: Date.now(),
    payload: { ...payload, sha256Hash: hash, expectedUserId: scope.userId, expectedCompanyId: scope.companyId },
    error: "Arquivamento ainda não confirmado pelo servidor.",
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("O navegador não disponibilizou o armazenamento local dos PDFs."))
      return
    }
    const request = indexedDB.open(DATABASE, 1)
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(STORE, { keyPath: "id" })
      store.createIndex("scope", "scopeKey")
    }
    request.onerror = () => reject(new Error("Não foi possível abrir a recuperação local de PDFs."))
    let blocked = false
    request.onblocked = () => {
      blocked = true
      reject(new Error("Feche outras abas desta versão para abrir a recuperação local de PDFs."))
    }
    request.onsuccess = () => {
      if (blocked) request.result.close()
      else resolve(request.result)
    }
  })
}

async function transact<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    let request: IDBRequest<T>
    let tx: IDBTransaction
    try {
      tx = db.transaction(STORE, mode)
      request = run(tx.objectStore(STORE))
    } catch {
      db.close()
      reject(new Error("Não foi possível acessar a recuperação local de PDFs."))
      return
    }
    tx.oncomplete = () => { db.close(); resolve(request.result) }
    const failed = () => {
      db.close()
      reject(new Error("Não foi possível salvar a recuperação local. Verifique o espaço disponível no navegador."))
    }
    tx.onerror = failed
    tx.onabort = failed
  })
}

export async function listPendingDocumentArchives(scope: ArchiveScope): Promise<PendingDocumentArchive[]> {
  const scopeKey = archiveScopeKey(scope)
  const rows = await transact("readonly", store => store.index("scope").getAll(scopeKey)) as PendingDocumentArchive[]
  return rows.filter(row => row.scopeKey === scopeKey && row.userId === scope.userId && row.companyId === scope.companyId)
    .sort((a, b) => a.createdAt - b.createdAt)
}

export async function putPendingDocumentArchive(entry: PendingDocumentArchive): Promise<void> {
  if (entry.payload.linkToken || entry.scopeKey !== archiveScopeKey(entry)) {
    throw new Error("Documento incompatível com a recuperação local autenticada.")
  }
  await transact("readwrite", store => store.put(entry))
}

export async function removePendingDocumentArchive(scope: ArchiveScope, id: string): Promise<void> {
  const row = await transact("readonly", store => store.get(id)) as PendingDocumentArchive | undefined
  if (!row || row.scopeKey !== archiveScopeKey(scope) || row.userId !== scope.userId || row.companyId !== scope.companyId) return
  await transact("readwrite", store => store.delete(id))
}
