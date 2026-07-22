import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import HistoryPage from "@/app/history/page"
import type { DeliveryWithRelations } from "@/types/database"

const apiMocks = vi.hoisted(() => ({
  deleteDelivery: vi.fn(),
  getDeliveries: vi.fn(),
  getPrivateAssetUrl: vi.fn(),
  getSignedDocuments: vi.fn(),
  getThirdParties: vi.fn(),
}))

const toastMocks = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}))

vi.mock("@/services/api", () => ({ api: apiMocks }))
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { role: "ADMIN" } }),
}))
vi.mock("@/hooks/usePdfActionDialog", () => ({
  usePdfActionDialog: () => ({ openPdfDialog: vi.fn(), pdfActionDialog: null }),
}))
vi.mock("@/utils/pdfGenerator", () => ({ generateDeliveryPDF: vi.fn() }))
vi.mock("@/lib/toast", () => ({ toast: toastMocks }))

const delivery = {
  id: "4c1b1e39-1111-4111-8111-111111111111",
  company_id: "496835a8-9b36-4c31-b4a1-36e864fba38a",
  delivery_date: "2026-07-20T12:07:00.000Z",
  quantity: 1,
  reason: "Primeira Entrega",
  signature_url: "496835a8-9b36-4c31-b4a1-36e864fba38a/signature.png",
  employee: { full_name: "ANTONIO SANTOS DA SILVA", cpf: "", job_title: "" },
  ppe: { name: "OCULOS FUME", ca_number: "11268", cost: 4.35 },
  workplace: { name: "SEDE" },
} as unknown as DeliveryWithRelations

describe("HistoryPage", () => {
  afterEach(cleanup)

  beforeEach(() => {
    vi.clearAllMocks()
    apiMocks.getDeliveries.mockResolvedValue([delivery])
    apiMocks.getSignedDocuments.mockResolvedValue([])
    apiMocks.getThirdParties.mockResolvedValue([])
    apiMocks.getPrivateAssetUrl.mockResolvedValue("https://storage.example/fresh-signature.png")
  })

  it("mantem a tabela desktop sem quebras de linha", async () => {
    render(<HistoryPage />)

    const signatureButton = await screen.findByRole("button", { name: /abrir somente a assinatura/i })
    const table = signatureButton.closest("table")

    expect(table).toHaveClass("whitespace-nowrap")
    expect(signatureButton).toHaveClass("whitespace-nowrap")
    expect(apiMocks.getDeliveries).toHaveBeenCalledWith({ signAssets: false })
    expect(apiMocks.getSignedDocuments).toHaveBeenCalledWith({ signAssets: false })
  })

  it("gera uma URL nova ao abrir a assinatura em vez de reutilizar o link expirado", async () => {
    const replace = vi.fn()
    const popup = {
      closed: false,
      close: vi.fn(),
      location: { replace },
      opener: window,
    } as unknown as Window
    vi.spyOn(window, "open").mockReturnValue(popup)

    render(<HistoryPage />)
    await userEvent.click(await screen.findByRole("button", { name: /abrir somente a assinatura/i }))

    expect(window.open).toHaveBeenCalledWith("about:blank", "_blank")
    expect(apiMocks.getPrivateAssetUrl).toHaveBeenCalledWith(delivery.signature_url, "view")
    await waitFor(() => expect(replace).toHaveBeenCalledWith("https://storage.example/fresh-signature.png"))
  })

  it("nao confunde uma ficha NR-06 coletiva com o comprovante arquivado da entrega", async () => {
    apiMocks.getSignedDocuments.mockResolvedValue([{
      id: "nr06-1",
      document_type: "nr06",
      delivery_id: null,
      delivery_ids: [delivery.id],
      document_url: "signed-documents/company/ficha-nr06.pdf",
      storage_path: "signed-documents/company/ficha-nr06.pdf",
      sha256_hash: "abc123",
      created_at: "2026-07-21T10:00:00.000Z",
    }])

    render(<HistoryPage />)

    expect(await screen.findByRole("button", { name: /abrir somente a assinatura/i })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /abrir documento arquivado/i })).not.toBeInTheDocument()
  })
})
