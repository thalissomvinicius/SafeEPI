import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import MovementsPage from "@/app/movements/page"

const apiMocks = vi.hoisted(() => ({
  getDeliveries: vi.fn(),
  getEmployees: vi.fn(),
  getSignedDocuments: vi.fn(),
  getWorkplaces: vi.fn(),
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
vi.mock("@/hooks/usePdfActionDialog", () => ({
  usePdfActionDialog: () => ({ openPdfDialog: vi.fn(), pdfActionDialog: null }),
}))

describe("MovementsPage", () => {
  afterEach(cleanup)

  beforeEach(() => {
    vi.clearAllMocks()
    apiMocks.getDeliveries.mockResolvedValue([])
    apiMocks.getSignedDocuments.mockResolvedValue([])
    apiMocks.getEmployees.mockResolvedValue([])
    apiMocks.getWorkplaces.mockResolvedValue([])
  })

  it("nao assina centenas de arquivos privados durante a carga da tela", async () => {
    render(<MovementsPage />)

    await screen.findByText(/nenhuma movimentação neste período/i)
    expect(apiMocks.getDeliveries).toHaveBeenCalledWith({ signAssets: false })
    expect(apiMocks.getSignedDocuments).toHaveBeenCalledWith({ signAssets: false })
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
})
