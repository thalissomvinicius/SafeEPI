// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { IDBFactory, IDBObjectStore } from "fake-indexeddb"
import {
  createPendingDocumentArchive, listPendingDocumentArchives,
  putPendingDocumentArchive, removePendingDocumentArchive,
} from "@/lib/documentArchiveQueue"

const scope = { userId: "operator", companyId: "company-a" }
const payload = {
  documentType: "delivery" as const,
  fileName: "original.pdf",
  employeeId: "employee",
  deliveryIds: ["delivery-2", "delivery-1"],
  pdfBlob: new Blob(["%PDF-original-bytes"], { type: "application/pdf" }),
  metadata: { nested: { term: "accepted" } },
}
beforeEach(() => vi.stubGlobal("indexedDB", new IDBFactory()))
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe("fila local durável de comprovantes", () => {
  it("preserva os bytes e vínculos na clonagem do IndexedDB", async () => {
    const entry = await createPendingDocumentArchive(scope, payload)
    await putPendingDocumentArchive(entry)
    const [restored] = await listPendingDocumentArchives(scope)
    expect(restored.payload.fileName).toBe(payload.fileName)
    expect(restored.payload.deliveryIds).toEqual(payload.deliveryIds)
    expect(await restored.payload.pdfBlob.text()).toBe("%PDF-original-bytes")
    expect(restored.payload.pdfBlob).not.toBe(payload.pdfBlob)
    expect(restored.payload.expectedCompanyId).toBe(scope.companyId)
    expect(restored.payload.expectedUserId).toBe(scope.userId)
    expect(restored.payload.sha256Hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it("identifica o mesmo PDF e os mesmos vínculos de forma estável", async () => {
    const first = await createPendingDocumentArchive(scope, payload)
    const repeated = await createPendingDocumentArchive(scope, { ...payload, deliveryIds: ["delivery-1", "delivery-2", "delivery-1"] })
    expect(first.id).toBe(repeated.id)
    await putPendingDocumentArchive(first)
    await putPendingDocumentArchive(repeated)
    expect(await listPendingDocumentArchives(scope)).toHaveLength(1)
    const changed = await createPendingDocumentArchive(scope, { ...payload, pdfBlob: new Blob(["different PDF"]) })
    expect(changed.id).not.toBe(first.id)
  })

  it("isola leitura e remoção por usuário e empresa", async () => {
    const first = await createPendingDocumentArchive(scope, payload)
    const otherCompany = { ...scope, companyId: "company-b" }
    const otherUser = { ...scope, userId: "another-operator" }
    const second = await createPendingDocumentArchive(otherCompany, payload)
    const third = await createPendingDocumentArchive(otherUser, payload)
    await putPendingDocumentArchive(first)
    await putPendingDocumentArchive(second)
    await putPendingDocumentArchive(third)
    expect((await listPendingDocumentArchives(scope)).map(row => row.id)).toEqual([first.id])
    await removePendingDocumentArchive(otherUser, first.id)
    expect(await listPendingDocumentArchives(scope)).toHaveLength(1)
    await removePendingDocumentArchive(scope, first.id)
    expect(await listPendingDocumentArchives(scope)).toHaveLength(0)
    expect(await listPendingDocumentArchives(otherCompany)).toHaveLength(1)
    expect(await listPendingDocumentArchives(otherUser)).toHaveLength(1)
  })

  it("rejeita credenciais remotas e escopos locais incompatíveis", async () => {
    await expect(createPendingDocumentArchive(scope, { ...payload, linkToken: "secret" })).rejects.toThrow(/Links de assinatura/)
    const entry = await createPendingDocumentArchive(scope, payload)
    await expect(putPendingDocumentArchive({ ...entry, scopeKey: "other-scope" })).rejects.toThrow(/incompatível/)
    await expect(putPendingDocumentArchive({ ...entry, payload: { ...entry.payload, linkToken: "secret" } })).rejects.toThrow(/incompatível/)
    expect(await listPendingDocumentArchives(scope)).toHaveLength(0)
  })

  it("não confirma persistência se a gravação falhar", async () => {
    const entry = await createPendingDocumentArchive(scope, payload)
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(() => { throw new DOMException("Quota exceeded", "QuotaExceededError") })
    await expect(putPendingDocumentArchive(entry)).rejects.toThrow(/recuperação local/)
    expect(await listPendingDocumentArchives(scope)).toHaveLength(0)
  })

  it("informa quando o armazenamento está indisponível", async () => {
    vi.stubGlobal("indexedDB", undefined)
    await expect(listPendingDocumentArchives(scope)).rejects.toThrow(/não disponibilizou/)
  })
})
