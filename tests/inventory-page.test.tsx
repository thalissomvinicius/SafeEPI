import { Component, type ReactNode } from "react"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import InventoryPage from "@/app/inventory/page"

const mocks = vi.hoisted(() => ({
  getPpes: vi.fn(), getStockMovementsPage: vi.fn(), addStockMovement: vi.fn(),
  exportInventoryStockToExcel: vi.fn(),
  error: vi.fn(), success: vi.fn(), warning: vi.fn(),
}))
vi.mock("@/services/api", () => ({ api: mocks }))
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "user-1", role: "ADMIN", user_metadata: {} } }) }))
vi.mock("@/hooks/usePdfActionDialog", () => ({ usePdfActionDialog: () => ({ openPdfDialog: vi.fn(), pdfActionDialog: null }) }))
vi.mock("@/utils/pdfGenerator", () => ({ generateInventoryStockReportPDF: vi.fn() }))
vi.mock("@/utils/excelExporter", () => ({ exportInventoryStockToExcel: mocks.exportInventoryStockToExcel }))
vi.mock("@/lib/toast", () => ({ toast: mocks }))

const ppe = { id: "ppe-1", name: "Capacete de segurança", ca_number: "12345", ca_expiry_date: "2027-04-20", current_stock: 23 }
const movement = { id: "movement-1", ppe_id: "ppe-1", type: "ENTRADA", quantity: 5, motive: "Compra de estoque", created_at: "2026-10-15T12:00:00Z", ppe: { name: ppe.name } }

class CrashBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null }
  static getDerivedStateFromError(error: Error) { return { error: error.message } }
  render() { return this.state.error ? <p role="alert">Falha de renderização: {this.state.error}</p> : this.props.children }
}

describe("inventory rendering and recovery", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.getPpes.mockResolvedValue([ppe])
    mocks.getStockMovementsPage.mockResolvedValue({ movements: [movement], hasMore: false, total: 1 })
    mocks.addStockMovement.mockResolvedValue(movement)
    vi.spyOn(console, "error").mockImplementation(() => {})
  })
  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  it("keeps inventory usable when a CA expiry is a timestamp instead of a date-only string", async () => {
    mocks.getPpes.mockResolvedValue([{ ...ppe, ca_expiry_date: "2027-04-20T00:00:00.000Z" }])
    render(<CrashBoundary><InventoryPage /></CrashBoundary>)
    await waitFor(() => expect(screen.queryByText(/falha de renderização/i)).not.toBeInTheDocument())
    expect((await screen.findAllByText(ppe.name)).length).toBeGreaterThan(0)
    await userEvent.click(screen.getByRole("button", { name: "Ver mais" }))
    expect(screen.getByText("20/04/2027")).toBeInTheDocument()
  })

  it("keeps balances and history visible when a legacy movement has no date", async () => {
    mocks.getStockMovementsPage.mockResolvedValue({ movements: [{ ...movement, created_at: null }], hasMore: false, total: 1 })
    render(<CrashBoundary><InventoryPage /></CrashBoundary>)
    expect(await screen.findByText("Data não informada")).toBeInTheDocument()
    expect(screen.queryByText(/falha de renderização/i)).not.toBeInTheDocument()
    expect(screen.getAllByText("23").length).toBeGreaterThan(0)
  })

  it("shows confirmed balances even if history is temporarily unavailable, then retries reads only", async () => {
    mocks.getStockMovementsPage.mockRejectedValueOnce(new TypeError("Failed to fetch"))
    render(<InventoryPage />)
    expect((await screen.findAllByText(ppe.name)).length).toBeGreaterThan(0)
    expect(screen.getByRole("alert")).toHaveTextContent(/histórico/i)
    expect(screen.queryByText("Sem histórico registrado.")).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: /tentar novamente/i }))
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument())
    expect(mocks.addStockMovement).not.toHaveBeenCalled()
  })

  it("distinguishes a saved movement from a failed refresh and preserves the selected EPI", async () => {
    mocks.getPpes.mockResolvedValue([ppe, { ...ppe, id: "ppe-2", name: "Luva de proteção" }])
    render(<InventoryPage />)
    await screen.findAllByText(ppe.name)
    await userEvent.click(screen.getByRole("button", { name: "Movimentar estoque" }))
    await userEvent.selectOptions(screen.getByLabelText("Equipamento (EPI)"), "ppe-2")
    mocks.getPpes.mockRejectedValueOnce(new TypeError("Failed to fetch"))
    await userEvent.click(screen.getByRole("button", { name: "Confirmar movimentação" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect(mocks.addStockMovement).toHaveBeenCalledTimes(1)
    expect(mocks.warning).toHaveBeenCalledWith(expect.stringMatching(/registrad.*atualiza/i))
    expect(mocks.error).not.toHaveBeenCalled()
    expect(screen.getByRole("alert")).toHaveTextContent(/última consulta/i)
    await userEvent.click(screen.getByRole("button", { name: /tentar novamente/i }))
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument())
    await userEvent.click(screen.getByRole("button", { name: "Movimentar estoque" }))
    expect(screen.getByLabelText("Equipamento (EPI)")).toHaveValue("ppe-2")
    expect(mocks.addStockMovement).toHaveBeenCalledTimes(1)
  })

  it("keeps the export button busy until the file finishes and reports a write failure", async () => {
    let rejectExport!: (reason: Error) => void
    mocks.exportInventoryStockToExcel.mockReturnValue(new Promise((_resolve, reject) => { rejectExport = reject }))
    render(<InventoryPage />)
    await screen.findAllByText(ppe.name)
    const excel = screen.getByRole("button", { name: "Excel" })
    await userEvent.click(excel)
    expect(excel).toBeDisabled()
    expect(excel).toHaveAttribute("aria-busy", "true")
    await userEvent.click(excel)
    expect(mocks.exportInventoryStockToExcel).toHaveBeenCalledTimes(1)
    await act(async () => rejectExport(new Error("Falha de gravação")))
    expect(mocks.error).toHaveBeenCalledWith(expect.stringMatching(/exportar o estoque/i))
    expect(excel).toBeEnabled()
  })

  it("sends only one stock mutation while a confirmation is pending", async () => {
    let completeMovement!: (value: typeof movement) => void
    mocks.addStockMovement.mockReturnValue(new Promise(resolve => { completeMovement = resolve }))
    render(<InventoryPage />)
    await screen.findAllByText(ppe.name)
    await userEvent.click(screen.getByRole("button", { name: "Movimentar estoque" }))
    const submit = screen.getByRole("button", { name: "Confirmar movimentação" })
    const form = submit.closest("form")!
    fireEvent.submit(form)
    fireEvent.submit(form)
    expect(mocks.addStockMovement).toHaveBeenCalledTimes(1)
    expect(submit).toHaveAttribute("aria-busy", "true")
    expect(submit).toBeDisabled()
    await act(async () => completeMovement(movement))
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })
})
