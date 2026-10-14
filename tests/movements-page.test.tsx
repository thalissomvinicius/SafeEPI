import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import MovementsPage from "@/app/movements/page"

const apiMocks = vi.hoisted(() => ({
  getDeliveries: vi.fn(),
  getEmployees: vi.fn(),
  getSignedDocuments: vi.fn(),
  getWorkplaces: vi.fn(),
  generateMovementsSimplePDF: vi.fn(),
}))

const authUser = {
  id: "user-1",
  email: "admin@example.com",
  role: "ADMIN",
  user_metadata: {},
}

vi.mock("@/services/api", () => ({ api: apiMocks }))
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    loading: false,
    user: authUser,
  }),
}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock("react-signature-canvas", () => ({ default: () => null }))
vi.mock("@/utils/pdfGenerator", () => ({
  generateDeliveryPDF: vi.fn(),
  generateMovementsSimplePDF: apiMocks.generateMovementsSimplePDF,
  generateMovementsPresentationPDF: vi.fn(),
}))
vi.mock("@/hooks/usePdfActionDialog", () => ({
  usePdfActionDialog: () => ({ openPdfDialog: vi.fn(), pdfActionDialog: null }),
}))

describe("MovementsPage", () => {
  afterEach(cleanup)

  beforeEach(() => {
    vi.resetAllMocks()
    apiMocks.getDeliveries.mockResolvedValue([])
    apiMocks.getSignedDocuments.mockResolvedValue([])
    apiMocks.getEmployees.mockResolvedValue([])
    apiMocks.getWorkplaces.mockResolvedValue([])
    apiMocks.generateMovementsSimplePDF.mockReturnValue(new Blob(["PDF"], { type: "application/pdf" }))
  })

  it("nao assina centenas de arquivos privados durante a carga da tela", async () => {
    render(<MovementsPage />)

    await screen.findByText(/nenhuma movimentação neste período/i)
    expect(apiMocks.getDeliveries).toHaveBeenCalledWith({ signAssets: false })
    expect(apiMocks.getSignedDocuments).toHaveBeenCalledWith({ signAssets: false })
    expect(apiMocks.getEmployees).toHaveBeenCalledWith({ signPhotos: false })
  })

  it("mostra uma falha recuperavel sem transformar os dados em zero", async () => {
    apiMocks.getDeliveries.mockRejectedValueOnce(new TypeError("Failed to fetch"))

    render(<MovementsPage />)

    expect(await screen.findByRole("alert")).toHaveTextContent(/temporariamente indispon/i)
    expect(screen.queryByText("Acessando banco de dados")).not.toBeInTheDocument()
    expect(screen.queryAllByText(/^0$/)).toHaveLength(0)

    await userEvent.click(screen.getByRole("button", { name: /tentar novamente/i }))
    expect(await screen.findByText(/nenhuma movimentação neste período/i)).toBeInTheDocument()
  })

  it("informa a carga parcial e libera exportação somente após carregar as páginas restantes", async () => {
    const entries = Array.from({ length: 500 }, (_, index) => ({
      id: `delivery-${index}`, employee_id: "employee-1", quantity: 1,
      delivery_date: new Date().toISOString(), employee: { full_name: "RENATO MOREIRA", cpf: "" }, ppe: { name: "Luva" },
    }))
    apiMocks.getDeliveries.mockResolvedValueOnce(entries).mockResolvedValueOnce([])
    render(<MovementsPage />)
    expect(await screen.findByText("Histórico carregado parcialmente")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Mostrar mais 100 movimentações" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Excel" })).toBeDisabled()
    await userEvent.click(screen.getByRole("button", { name: "Carregar mais 500 registros" }))
    await waitFor(() => expect(screen.queryByText("Histórico carregado parcialmente")).not.toBeInTheDocument())
    expect(apiMocks.getDeliveries).toHaveBeenLastCalledWith({ offset: 500, limit: 500, signAssets: false })
    expect(screen.getByRole("button", { name: "Excel" })).toBeEnabled()
  }, 15000)

  it("emite em um único relatório os EPIs do colaborador selecionado no período", async () => {
    apiMocks.getEmployees.mockResolvedValue([
      { id: "employee-1", full_name: "RENATO MOREIRA", active: true },
      { id: "employee-2", full_name: "LÍVIA FIGUEIREDO", active: true },
    ])
    apiMocks.getDeliveries.mockResolvedValue([
      { id: "one", employee_id: "employee-1", quantity: 2, delivery_date: new Date().toISOString(), employee: { full_name: "RENATO MOREIRA", cpf: "" }, ppe: { name: "Luva" } },
      { id: "two", employee_id: "employee-1", quantity: 1, delivery_date: new Date().toISOString(), employee: { full_name: "RENATO MOREIRA", cpf: "" }, ppe: { name: "Capacete" } },
      { id: "three", employee_id: "employee-2", quantity: 1, delivery_date: new Date().toISOString(), employee: { full_name: "LÍVIA FIGUEIREDO", cpf: "" }, ppe: { name: "Óculos" } },
    ])
    render(<MovementsPage />)
    await screen.findByRole("option", { name: "RENATO MOREIRA" })
    await userEvent.selectOptions(screen.getByLabelText("Relatório de EPIs por colaborador"), "employee-1")
    await userEvent.click(screen.getByRole("button", { name: "Emitir EPIs do período" }))
    await userEvent.click(screen.getByRole("button", { name: "Gerar PDF simples" }))
    const payload = apiMocks.generateMovementsSimplePDF.mock.calls[0][0]
    expect(payload.movements.map((record: { id: string }) => record.id).sort()).toEqual(["one", "two"])
    expect(payload.stats.totalItems).toBe(3)
  })
})
