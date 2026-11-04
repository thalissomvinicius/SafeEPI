import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { PendingDocumentArchive } from "@/lib/documentArchiveQueue"
import type { SignedDocumentArchivePayload } from "@/services/api"
const m = vi.hoisted(() => ({
  archive: vi.fn(), saveDelivery: vi.fn(), put: vi.fn(), list: vi.fn(), remove: vi.fn(), context: vi.fn(),
  user: { id: "operator", role: "ADMIN", company_id: "company-a" } as { id: string; role: string; company_id: string } | null,
  records: new Map<string, PendingDocumentArchive>(),
}))
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: m.user }) }))
vi.mock("@/services/api", () => ({ api: { archiveSignedDocument: m.archive, saveDelivery: m.saveDelivery, getArchiveContext: m.context } }))
vi.mock("@/lib/documentArchiveQueue", () => ({
  archiveScopeKey: (scope: { userId: string; companyId: string }) => JSON.stringify([scope.userId, scope.companyId]),
  createPendingDocumentArchive: async (scope: { userId: string; companyId: string }, value: SignedDocumentArchivePayload) => ({
    id: `${scope.userId}:${scope.companyId}:${value.fileName}`,
    scopeKey: JSON.stringify([scope.userId, scope.companyId]), ...scope, createdAt: 1, error: "Pendente",
    payload: { ...value, sha256Hash: "same-pdf-hash", expectedUserId: scope.userId, expectedCompanyId: scope.companyId },
  }),
  putPendingDocumentArchive: m.put,
  listPendingDocumentArchives: m.list,
  removePendingDocumentArchive: m.remove,
}))
import { useDocumentArchive } from "@/hooks/useDocumentArchive"
const payload = { documentType: "delivery" as const, fileName: "original.pdf", pdfBlob: new Blob(["pdf"]), deliveryIds: ["original-delivery"] }
function Fixture({ value = payload }: { value?: SignedDocumentArchivePayload }) {
  const { archiveDocument, archiveRecovery } = useDocumentArchive()
  return <><button onClick={() => void archiveDocument(value).catch(() => {})}>Arquivar</button>{archiveRecovery}</>
}

beforeEach(() => {
  window.history.replaceState(null, "", "/")
  vi.resetAllMocks()
  m.records.clear()
  m.user = { id: "operator", role: "ADMIN", company_id: "company-a" }
  m.context.mockImplementation(async () => ({ userId: m.user?.id, companyId: m.user?.company_id }))
  m.put.mockImplementation(async (entry: PendingDocumentArchive) => { m.records.set(entry.id, entry) })
  m.list.mockImplementation(async (scope: { userId: string; companyId: string }) => [...m.records.values()].filter(row => row.userId === scope.userId && row.companyId === scope.companyId))
  m.remove.mockImplementation(async (_scope: unknown, id: string) => { m.records.delete(id) })
})
afterEach(cleanup)
describe("recuperação de PDF sem replay de estoque", () => {
  it("persiste antes da requisição e reenvia os mesmos bytes/vínculos até confirmar", async () => {
    m.archive.mockRejectedValueOnce(new Error("Offline")).mockResolvedValueOnce({ id: "archived" })
    render(<Fixture />)
    fireEvent.click(screen.getByRole("button", { name: "Arquivar" }))
    await screen.findByText("Offline")
    expect(m.put.mock.invocationCallOrder[0]).toBeLessThan(m.archive.mock.invocationCallOrder[0])
    expect(m.records.size).toBe(1)
    fireEvent.click(screen.getByRole("button", { name: "Tentar arquivar PDF novamente" }))
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument())
    expect(m.archive.mock.calls[1][0]).toEqual({ ...payload, sha256Hash: "same-pdf-hash", expectedUserId: "operator", expectedCompanyId: "company-a" })
    expect(m.records.size).toBe(0)
    expect(m.saveDelivery).not.toHaveBeenCalled()
  })

  it("recupera pendência após remontagem sem enviar automaticamente", async () => {
    m.archive.mockRejectedValue(new Error("Offline"))
    const mounted = render(<Fixture />)
    fireEvent.click(screen.getByRole("button", { name: "Arquivar" }))
    await screen.findByText("Offline")
    mounted.unmount()
    render(<Fixture />)
    await screen.findByText("PDF com arquivamento pendente")
    expect(screen.getByText(/Você pode retomar após recarregar/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Baixar PDF pendente" })).toBeInTheDocument()
    expect(m.archive).toHaveBeenCalledTimes(1)
  })

  it("não mostra pendências de outro usuário ou empresa, nem após logout", async () => {
    m.archive.mockRejectedValue(new Error("Offline"))
    const mounted = render(<Fixture />)
    fireEvent.click(screen.getByRole("button", { name: "Arquivar" }))
    await screen.findByText("Offline")
    m.user = { id: "other-operator", role: "ADMIN", company_id: "company-a" }
    mounted.rerender(<Fixture />)
    expect(screen.queryByText("original.pdf")).not.toBeInTheDocument()
    await waitFor(() => expect(m.list).toHaveBeenCalledWith({ userId: "other-operator", companyId: "company-a" }))
    m.user = { id: "operator", role: "ADMIN", company_id: "company-b" }
    mounted.rerender(<Fixture />)
    expect(screen.queryByText("original.pdf")).not.toBeInTheDocument()
    m.user = null
    mounted.rerender(<Fixture />)
    expect(screen.queryByText("original.pdf")).not.toBeInTheDocument()
    expect(m.records.size).toBe(1)
  })

  it("informa quando falta armazenamento e mantém download e recuperação em memória", async () => {
    m.put.mockRejectedValue(new Error("Sem espaço no navegador"))
    m.archive.mockRejectedValue(new Error("Offline"))
    render(<Fixture />)
    fireEvent.click(screen.getByRole("button", { name: "Arquivar" }))
    await screen.findByText("Offline")
    expect(screen.getByText("Sem espaço no navegador")).toBeInTheDocument()
    expect(screen.getByText(/esta cópia não será recuperada/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Baixar PDF pendente" })).toBeInTheDocument()
    expect(m.archive).toHaveBeenCalledTimes(1)
  })

  it("recusa retry quando o contexto real mudou mesmo que a tela ainda não tenha atualizado", async () => {
    m.archive.mockRejectedValueOnce(new Error("Offline"))
    render(<Fixture />)
    fireEvent.click(screen.getByRole("button", { name: "Arquivar" }))
    await screen.findByText("Offline")
    m.context.mockResolvedValue({ userId: "operator", companyId: "company-b" })
    fireEvent.click(screen.getByRole("button", { name: "Tentar arquivar PDF novamente" }))
    await screen.findByText(/Retorne ao contexto original/)
    expect(m.archive).toHaveBeenCalledTimes(1)
    expect(m.records.size).toBe(1)
  })

  it("não persiste credenciais dos links públicos de assinatura", async () => {
    m.user = null
    m.archive.mockRejectedValueOnce(new Error("Offline"))
    render(<Fixture value={{ ...payload, linkToken: "private-remote-token" }} />)
    fireEvent.click(screen.getByRole("button", { name: "Arquivar" }))
    await screen.findByText("Offline")
    expect(m.put).not.toHaveBeenCalled()
    expect(m.records.size).toBe(0)
    expect(screen.getByText(/esta cópia não será recuperada/)).toBeInTheDocument()
  })

  it.each([false, true])("isola links remotos ao trocar o token sem remontar a tela (logado=%s)", async loggedIn => {
    if (!loggedIn) m.user = null
    window.history.replaceState(null, "", "/delivery/remote?token=first-token")
    m.archive.mockRejectedValue(new Error("Offline"))
    const mounted = render(<Fixture value={{ ...payload, linkToken: "first-token" }} />)
    fireEvent.click(screen.getByRole("button", { name: "Arquivar" }))
    await screen.findByText("Offline")
    expect(screen.getByText("original.pdf")).toBeInTheDocument()

    window.history.replaceState(null, "", "/delivery/remote?token=second-token")
    mounted.rerender(<Fixture value={{ ...payload, fileName: "second.pdf", linkToken: "second-token" }} />)
    expect(screen.queryByText("original.pdf")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Tentar arquivar PDF novamente" })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Arquivar" }))
    await screen.findByText("second.pdf")
    await screen.findByText("Offline")
    expect(m.archive.mock.calls[1][0].linkToken).toBe("second-token")
    expect(m.put).not.toHaveBeenCalled()
    expect(m.list).not.toHaveBeenCalled()
  })
})
