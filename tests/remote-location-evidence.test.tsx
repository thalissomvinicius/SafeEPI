import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import RemoteDeliveryPage from "@/app/delivery/remote/page"

const mocks = vi.hoisted(() => ({
  params: new URLSearchParams({ t: "synthetic-link" }),
  geolocation: vi.fn(), pdf: vi.fn(), archive: vi.fn(), fetch: vi.fn(),
}))
vi.mock("next/navigation", () => ({ useSearchParams: () => mocks.params }))
vi.mock("@/services/api", () => ({ api: { archiveSignedDocument: mocks.archive } }))
vi.mock("@/utils/pdfGenerator", () => ({ generateDeliveryPDF: mocks.pdf }))
vi.mock("@/utils/geolocation", () => ({ isValidGeoLocation: (value: string) => /^-?\d+\.\d+, -?\d+\.\d+$/.test(value), requestRequiredGeolocation: mocks.geolocation }))
vi.mock("@/utils/signatureCanvas", () => ({ getSignatureDataUrl: () => "data:image/png;base64,c3ludGhldGljLWltYWdl" }))
vi.mock("@/components/ui/FaceCamera", () => ({ FaceCamera: () => null }))
vi.mock("@/components/ui/FacialDeliveryConfirmation", () => ({ FacialDeliveryConfirmation: () => null }))
vi.mock("@/components/ui/SignatureCapture", () => ({ SignatureCapture: ({ signatureRef, onConfirm }: { signatureRef: { current: unknown }; onConfirm: () => void }) => <button onClick={() => { signatureRef.current = { isEmpty: () => false }; onConfirm() }}>Assinar e confirmar</button> }))
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal("fetch", mocks.fetch)
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:synthetic-pdf") })
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() })
  vi.spyOn(window, "scrollTo").mockImplementation(() => {})
  mocks.pdf.mockResolvedValue(new Blob(["synthetic PDF"], { type: "application/pdf" }))
  mocks.archive.mockResolvedValue({})
  mocks.fetch.mockImplementation((url: string, init?: RequestInit) => {
    if (url.includes("api.ipify.org")) return new Promise((_resolve, reject) => { init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }) })
    if (url.startsWith("/api/remote-links")) return Promise.resolve({ ok: true, json: async () => ({ link: {
      token: "synthetic-link", data: { e: "employee", p: "ppe", w: "workplace", q: 1, r: "Primeira Entrega" },
      employee: { id: "employee", full_name: "Colaborador de teste", cpf: "000.000.000-00", job_title: "Teste" },
      ppe: { id: "ppe", name: "Capacete de teste", ca_number: "TESTE", ca_expiry_date: "2099-01-01" },
    } }) })
    if (url === "/api/remote-delivery") return Promise.resolve({ ok: true, json: async () => ({ deliveryIds: ["delivery"], data: { id: "delivery", signature_url: "private-path" } }) })
    throw new Error(`Unexpected request ${url}`)
  })
})

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

async function openSigning() {
  render(<RemoteDeliveryPage />)
  fireEvent.change(await screen.findByLabelText("CPF"), { target: { value: "00000000000" } })
  fireEvent.click(screen.getByRole("button", { name: "Conferir dados e continuar" }))
}

describe("remote location evidence", () => {
  it("identifica rede aproximada no fluxo, PDF e metadata sem depender do IP", async () => {
    mocks.geolocation.mockResolvedValue({ ok: true, value: "-23.5505, -46.6333", source: "network" })
    await openSigning()
    expect(await screen.findByRole("status")).toHaveTextContent("Não representa a posição GPS")
    fireEvent.click(screen.getByRole("button", { name: "Assinar e confirmar" }))
    await waitFor(() => expect(mocks.archive).toHaveBeenCalled())
    expect(mocks.pdf).toHaveBeenCalledWith(expect.objectContaining({ location: "-23.5505, -46.6333 (aproximada da rede)" }))
    expect(mocks.archive).toHaveBeenCalledWith(expect.objectContaining({ geoLocation: "-23.5505, -46.6333", metadata: expect.objectContaining({ geolocationSource: "network" }) }))
    expect(mocks.geolocation).toHaveBeenCalledTimes(1)
    expect(mocks.fetch.mock.calls.some(([url]) => typeof url === "string" && url.startsWith("data:"))).toBe(false)
  })

  it("mostra precisao do dispositivo sem confundir com aproximacao de rede", async () => {
    mocks.geolocation.mockResolvedValue({ ok: true, value: "-23.550520, -46.633308", source: "device", accuracyMeters: 18 })
    await openSigning()
    expect(await screen.findByRole("status")).toHaveTextContent("precisão informada: 18 m")
    expect(screen.queryByText(/Não representa a posição GPS/)).not.toBeInTheDocument()
  })

  it("não oferece nova entrega quando o PDF falha depois da assinatura gravada", async () => {
    mocks.geolocation.mockResolvedValue({ ok: true, value: "-23.5505, -46.6333", source: "network" })
    mocks.pdf.mockRejectedValue(new Error("Falha sintética no PDF"))
    vi.spyOn(console, "error").mockImplementation(() => {})
    await openSigning()
    fireEvent.click(await screen.findByRole("button", { name: "Assinar e confirmar" }))
    expect(await screen.findByText(/Não é necessário assinar novamente/)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Assinar e confirmar" })).not.toBeInTheDocument()
    expect(mocks.fetch.mock.calls.filter(([url]) => url === "/api/remote-delivery")).toHaveLength(1)
  })

  it("distingue assinatura salva e PDF não arquivado no resultado", async () => {
    mocks.geolocation.mockResolvedValue({ ok: true, value: "-23.5505, -46.6333", source: "network" })
    mocks.archive.mockRejectedValue(new Error("Arquivo pendente"))
    await openSigning()
    fireEvent.click(await screen.findByRole("button", { name: "Assinar e confirmar" }))
    expect(await screen.findByText(/o arquivamento do PDF ficou pendente/)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Baixar PDF" })).toBeInTheDocument()
  })
})
