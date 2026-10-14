import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import ReturnsPage from "@/app/returns/page"

const mocks = vi.hoisted(() => ({
  employees: vi.fn(), ppes: vi.fn(), workplaces: vi.fn(), history: vi.fn(),
  returnDelivery: vi.fn(), saveDelivery: vi.fn(), archive: vi.fn(), pdf: vi.fn(),
  photo: vi.fn(), signature: vi.fn(),
}))
vi.mock("@/services/api", () => ({ api: {
  getEmployees: mocks.employees, getPpes: mocks.ppes, getWorkplaces: mocks.workplaces,
  getEmployeeHistory: mocks.history, returnDelivery: mocks.returnDelivery,
  saveDelivery: mocks.saveDelivery, archiveSignedDocument: mocks.archive,
  getPrivateAssetUrl: async () => "private-photo",
} }))
vi.mock("@/utils/pdfGenerator", () => ({ generateReturnPDF: mocks.pdf }))
vi.mock("@/utils/signatureCanvas", () => ({ getSignatureDataUrl: () => "synthetic-signature" }))
vi.mock("@/utils/imageDataUrl", () => ({ imageDataUrlToFile: mocks.signature, fetchImageDataUrl: mocks.photo }))
vi.mock("@/components/ui/SignatureCapture", () => ({ SignatureCapture: ({ onConfirm, confirmLabel }: { onConfirm: () => void; confirmLabel: string }) => <button onClick={onConfirm}>{confirmLabel}</button> }))
vi.mock("@/components/ui/BottomSheet", () => ({ BottomSheet: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <div>{children}</div> : null }))
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn() } }))

const employee = { id: "employee-a", full_name: "Colaborador A", cpf: "00000000000", active: true, workplace_id: "workplace", third_party_id: "contractor", photo_storage_path: "photo" }
const original = { id: "old", employee_id: employee.id, ppe_id: "old-ppe", quantity: 5, returned_quantity: 2, returned_at: null, return_motive: null, delivery_date: "2026-10-01T12:00:00Z", ppe: { name: "Capacete anterior", ca_number: "123" } }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.employees.mockResolvedValue([employee, { ...employee, id: "employee-b", full_name: "Colaborador B" }])
  mocks.ppes.mockResolvedValue([{ id: "new-ppe", name: "Capacete novo", ca_number: "456", active: true, current_stock: 10 }])
  mocks.workplaces.mockResolvedValue([{ id: "workplace", name: "Obra" }])
  mocks.history.mockResolvedValue([original])
  mocks.returnDelivery.mockResolvedValue({ ok: true, quantity_returned_now: 3, returned_quantity: 5 })
  mocks.saveDelivery.mockResolvedValue({ id: "replacement", signature_url: "private-signature" })
  mocks.pdf.mockResolvedValue(new Blob(["synthetic PDF"], { type: "application/pdf" }))
  mocks.archive.mockResolvedValue({})
  mocks.photo.mockResolvedValue("synthetic-photo")
  mocks.signature.mockReturnValue(new File(["signature"], "signature.png", { type: "image/png" }))
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:synthetic-pdf") })
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() })
})

afterEach(cleanup)

async function prepareReturn() {
  render(<ReturnsPage />)
  fireEvent.click(await screen.findByRole("button", { name: /Colaborador A/ }))
  fireEvent.click(await screen.findByRole("button", { name: "Registrar baixa" }))
  fireEvent.click(screen.getByRole("button", { name: "Dano ou quebra" }))
  fireEvent.click(screen.getByRole("button", { name: /Capacete novo/ }))
  fireEvent.click(screen.getByRole("button", { name: "Conferir e assinar" }))
}

describe("returns workflow UI", () => {
  it("retries the receipt after a PDF failure without repeating the return or replacement", async () => {
    mocks.pdf.mockRejectedValueOnce(new Error("PDF indisponível"))
    await prepareReturn()
    fireEvent.click(screen.getByRole("button", { name: "Foto + assinatura" }))
    fireEvent.click(screen.getByRole("button", { name: "Confirmar baixa e reposição" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("A baixa já está confirmada")
    expect(mocks.returnDelivery).toHaveBeenCalledExactlyOnceWith("old", "Dano", { quantity: 3, restock: false, employeeId: employee.id, expectedReturnedQuantity: 2 })
    expect(mocks.saveDelivery).toHaveBeenCalledWith(expect.objectContaining({ quantity: 3, reason: "Dano", third_party_id: "contractor", auth_method: "manual_facial" }), expect.any(File), undefined, { idempotencyKey: expect.any(String) })
    fireEvent.click(screen.getByRole("button", { name: "Retomar a conclusão" }))
    expect(await screen.findByRole("heading", { name: "Baixa concluída" })).toBeInTheDocument()
    expect(mocks.returnDelivery).toHaveBeenCalledTimes(1)
    expect(mocks.saveDelivery).toHaveBeenCalledTimes(1)
    expect(mocks.pdf).toHaveBeenCalledTimes(2)
    expect(mocks.archive).toHaveBeenCalledTimes(1)
  })

  it("reuses the exact replacement key after a lost response", async () => {
    mocks.saveDelivery.mockRejectedValueOnce(new Error("Resposta interrompida"))
    await prepareReturn()
    fireEvent.click(screen.getByRole("button", { name: "Confirmar baixa e reposição" }))
    await screen.findByRole("alert")
    const originalKey = mocks.saveDelivery.mock.calls[0][3]
    fireEvent.click(screen.getByRole("button", { name: "Retomar a conclusão" }))
    expect(await screen.findByRole("heading", { name: "Baixa concluída" })).toBeInTheDocument()
    expect(mocks.returnDelivery).toHaveBeenCalledTimes(1)
    expect(mocks.saveDelivery.mock.calls[1][3]).toEqual(originalKey)
  })

  it("does not mutate stock if signature conversion fails", async () => {
    mocks.signature.mockImplementation(() => { throw new Error("Invalid image") })
    await prepareReturn()
    fireEvent.click(screen.getByRole("button", { name: "Confirmar baixa e reposição" }))
    expect(mocks.returnDelivery).not.toHaveBeenCalled()
    expect(mocks.saveDelivery).not.toHaveBeenCalled()
  })

  it("ignores a previous employee response received after another employee was selected", async () => {
    let resolveFirst!: (value: unknown) => void
    mocks.history.mockImplementation((id: string) => id === employee.id ? new Promise(resolve => { resolveFirst = resolve }) : Promise.resolve([]))
    render(<ReturnsPage />)
    fireEvent.click(await screen.findByRole("button", { name: /Colaborador A/ }))
    fireEvent.click(screen.getByRole("button", { name: /Colaborador B/ }))
    expect(await screen.findByText("Nenhum EPI pendente de devolução.")).toBeInTheDocument()
    resolveFirst([original])
    await waitFor(() => expect(screen.queryByRole("button", { name: "Registrar baixa" })).not.toBeInTheDocument())
    expect(screen.getByRole("heading", { name: "Colaborador B" })).toBeInTheDocument()
  })
})
