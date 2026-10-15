import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import ReportsPage from "@/app/reports/page"
import MovementsPage from "@/app/movements/page"

const mocks = vi.hoisted(() => ({
  user: { id: "user-1", role: "ADMIN" }, router: { push: vi.fn() },
  getPpes: vi.fn(), getDeliveries: vi.fn(), getTrainings: vi.fn(), getWorkplaces: vi.fn(),
  getEmployees: vi.fn(), getThirdParties: vi.fn(), getSignedDocuments: vi.fn(),
  exportDeliveries: vi.fn(), exportMovements: vi.fn(), generateGeneralPDF: vi.fn(), openPdfDialog: vi.fn(),
}))
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: mocks.user, loading: false }) }))
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }))
vi.mock("@/services/api", () => ({ api: mocks }))
vi.mock("@/hooks/useActiveBrand", () => ({ useActiveBrand: () => ({ primaryColor: "#2563EB" }) }))
vi.mock("@/hooks/usePdfActionDialog", () => ({ usePdfActionDialog: () => ({ openPdfDialog: mocks.openPdfDialog, pdfActionDialog: null }) }))
vi.mock("@/utils/excelExporter", () => ({ exportDeliveriesToExcel: mocks.exportDeliveries, exportMovementEventsToExcel: mocks.exportMovements }))
vi.mock("@/utils/pdfGenerator", () => ({ generateGeneralReportPDF: mocks.generateGeneralPDF, generateDeliveryPDF: vi.fn(), generateMovementsSimplePDF: vi.fn(), generateMovementsPresentationPDF: vi.fn() }))
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock("recharts", () => Object.fromEntries(["PieChart", "Pie", "Cell", "ResponsiveContainer", "BarChart", "Bar", "XAxis", "YAxis", "Tooltip", "Legend", "CartesianGrid"].map((key) => [key, () => null])))

const delivery = { id: "delivery-1", employee_id: "employee-1", ppe_id: "ppe-1", quantity: 1, delivery_date: new Date().toISOString(), employee: { id: "employee-1", full_name: "Colaborador de teste", cpf: "00000000000" }, ppe: { name: "Capacete", cost: 20 }, workplace: { name: "Obra de teste" } }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getPpes.mockResolvedValue([])
  mocks.getDeliveries.mockResolvedValue([delivery])
  mocks.getTrainings.mockResolvedValue([])
  mocks.getWorkplaces.mockResolvedValue([])
  mocks.getEmployees.mockResolvedValue([])
  mocks.getThirdParties.mockResolvedValue([])
  mocks.getSignedDocuments.mockResolvedValue([])
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe("report actions", () => {
  it.each([
    ["reports", ReportsPage, mocks.exportDeliveries],
    ["movements", MovementsPage, mocks.exportMovements],
  ] as const)("%s prevents duplicate Excel exports and offers a retry after failure", async (_, Page, exportMock) => {
    let rejectExport!: (error: Error) => void
    exportMock.mockImplementationOnce(() => new Promise<void>((_, reject) => { rejectExport = reject }))
    exportMock.mockResolvedValueOnce(undefined)
    render(<Page />)
    const button = await screen.findByRole("button", { name: "Excel" })
    await waitFor(() => expect(button).toBeEnabled())
    fireEvent.click(button)
    fireEvent.click(button)
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute("aria-busy", "true")
    expect(exportMock).toHaveBeenCalledTimes(1)
    rejectExport(new Error("serialization failed"))
    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível gerar a planilha")
    await waitFor(() => expect(button).toBeEnabled())
    fireEvent.click(button)
    await waitFor(() => expect(exportMock).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("counts training records when the company has no PPE or deliveries", async () => {
    mocks.getDeliveries.mockResolvedValue([])
    mocks.getTrainings.mockResolvedValue([{ id: "training-1", completion_date: new Date().toISOString(), third_party_id: null }])
    render(<ReportsPage />)
    const label = await screen.findByText("Treinamentos (Neste Mês)")
    await waitFor(() => expect(label.parentElement).toHaveTextContent("1"))
    expect(screen.queryByText(/algoritmo SafeEPI/i)).not.toBeInTheDocument()
  })

  it.each(["PDF", "Exportar PDF"])("shows an actionable error if %s generation throws", async (buttonName) => {
    mocks.generateGeneralPDF.mockImplementationOnce(() => { throw new Error("PDF failure") })
    render(<ReportsPage />)
    const button = await screen.findByRole("button", { name: buttonName })
    await waitFor(() => expect(button).toBeEnabled())
    fireEvent.click(button)
    expect(button).toHaveAttribute("aria-busy", "true")
    fireEvent.click(button)
    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível gerar o PDF")
    expect(screen.getAllByRole("alert")).toHaveLength(1)
    expect(button).toBeEnabled()
    expect(mocks.generateGeneralPDF).toHaveBeenCalledTimes(1)
    expect(mocks.openPdfDialog).not.toHaveBeenCalled()
  })

  it.each([
    ["reports", ReportsPage],
    ["movements", MovementsPage],
  ] as const)("%s blocks stale exports after a failed period change and releases them after retry", async (pageName, Page) => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    render(<Page />)
    await waitFor(() => expect(screen.getByRole("button", { name: "Excel" })).toBeEnabled())
    mocks.getDeliveries.mockRejectedValue(new Error("Consulta indisponível"))
    if (pageName === "reports") {
      fireEvent.change(screen.getByTitle("Filtro de Período"), { target: { value: "last30" } })
    } else {
      fireEvent.click(screen.getByRole("button", { name: "30 Dias" }))
    }
    // Export must already be blocked before the refetch's delayed effect starts.
    expect(screen.getByRole("button", { name: "Excel" })).toBeDisabled()
    const alert = await screen.findByRole("alert")
    expect(alert).toBeInTheDocument()
    if (pageName === "movements") {
      expect(alert).toHaveTextContent("exportação está bloqueada")
      fireEvent.click(screen.getByRole("button", { name: "Excel" }))
      fireEvent.click(screen.getByRole("button", { name: "PDF" }))
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    } else {
      expect(screen.queryByRole("button", { name: "Excel" })).not.toBeInTheDocument()
    }
    expect(mocks.exportDeliveries).not.toHaveBeenCalled()
    expect(mocks.exportMovements).not.toHaveBeenCalled()
    mocks.getDeliveries.mockResolvedValue([delivery])
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }))
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument())
    await waitFor(() => expect(screen.getByRole("button", { name: "Excel" })).toBeEnabled())
  })

  it("keeps movement search usable with incomplete legacy employee fields", async () => {
    mocks.getDeliveries.mockResolvedValue([{ ...delivery, employee: { full_name: null, cpf: null } }])
    render(<MovementsPage />)
    await waitFor(() => expect(screen.getByRole("button", { name: "Excel" })).toBeEnabled())
    fireEvent.change(screen.getByPlaceholderText("Nome, CPF ou EPI..."), { target: { value: "Capacete" } })
    expect(screen.getByText("Capacete")).toBeInTheDocument()
  })
})
