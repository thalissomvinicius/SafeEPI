import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
const m = vi.hoisted(() => ({ archive: vi.fn(), saveDelivery: vi.fn() }))
vi.mock("@/services/api", () => ({ api: { archiveSignedDocument: m.archive, saveDelivery: m.saveDelivery } }))
import { useDocumentArchive } from "@/hooks/useDocumentArchive"
const payload = { documentType: "delivery" as const, fileName: "original.pdf", pdfBlob: new Blob(["pdf"]), deliveryIds: ["original-delivery"] }
function Fixture() {
  const { archiveDocument, archiveRecovery } = useDocumentArchive()
  return <><button onClick={() => void archiveDocument(payload).catch(() => {})}>Arquivar</button>{archiveRecovery}</>
}
afterEach(() => { cleanup(); vi.clearAllMocks() })
describe("recuperação de PDF sem replay de estoque", () => {
  it("reenvia os mesmos bytes/vínculos e remove pendência apenas após sucesso", async () => {
    m.archive.mockRejectedValueOnce(new Error("Offline")).mockResolvedValueOnce({ id: "archived" })
    render(<Fixture />)
    fireEvent.click(screen.getByRole("button", { name: "Arquivar" }))
    expect(await screen.findByText("PDF com arquivamento pendente")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Tentar arquivar PDF novamente" }))
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument())
    expect(m.archive).toHaveBeenNthCalledWith(2, payload)
    expect(m.saveDelivery).not.toHaveBeenCalled()
  })
})
