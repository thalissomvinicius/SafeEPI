import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import type SignatureCanvas from "react-signature-canvas"
import EmployeesPage from "@/app/employees/page"

const mocks = vi.hoisted(() => ({ archive: vi.fn(), generate: vi.fn(), getHistory: vi.fn() }))
const employee = { id: "employee-test", full_name: "COLABORADOR TESTE", cpf: "00000000000", active: true, job_title: "Operador", department: "Obra", workplace_id: null }
const technician = { ...employee, id: "technician-test", full_name: "RESPONSÁVEL TESTE", job_title: "Técnico de Segurança" }
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "operator-test", role: "ADMIN" } }) }))
vi.mock("@/services/api", () => ({ api: {
  getEmployees: async () => [employee, technician], getWorkplaces: async () => [], getThirdParties: async () => [],
  getJobTitles: async () => [], getDepartments: async () => [], getMasterCompanyContext: () => null,
  getEmployeeHistory: mocks.getHistory, getSignedDocuments: async () => [], archiveSignedDocument: mocks.archive,
} }))
vi.mock("@/utils/pdfGenerator", () => ({ generateNR06PDF: mocks.generate, generateEmployeesReportPDF: vi.fn() }))
vi.mock("@/components/ui/SignatureCapture", () => ({
  SignatureCapture: ({ signatureRef, onSignatureChange }: { signatureRef: { current: SignatureCanvas | null }; onSignatureChange: (present: boolean) => void }) =>
    <button onClick={() => {
      signatureRef.current = { isEmpty: () => false, toDataURL: () => "data:image/png;base64,signature" } as SignatureCanvas
      onSignatureChange(true)
    }}>Desenhar assinatura sintética</button>,
}))
vi.mock("@/components/biometrics/FingerprintEnrollmentManager", () => ({ FingerprintEnrollmentManager: () => null }))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getHistory.mockResolvedValue([{ id: "delivery-test", employee_id: employee.id, quantity: 1, delivery_date: "2026-10-14", reason: "Primeira Entrega", ppe: { name: "Capacete", ca_number: "12345", lifespan_days: 180 } }])
  mocks.generate.mockResolvedValue(new Blob(["synthetic-pdf"], { type: "application/pdf" }))
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:synthetic-document"), revokeObjectURL: vi.fn() }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

async function signAndGenerate() {
  render(<EmployeesPage />)
  fireEvent.click((await screen.findAllByRole("button", { name: "Prontuário" }))[0])
  fireEvent.click(await screen.findByRole("button", { name: /Ficha NR-06/i }))
  const signatureDialog = screen.getByRole("dialog", { name: "Assinar prontuario" })
  fireEvent.click(within(signatureDialog).getByRole("button", { name: /RESPONSÁVEL TESTE/i }))
  const generate = await screen.findByRole("button", { name: "Gerar Prontuário NR-06" })
  expect(generate).toBeDisabled()
  fireEvent.click(screen.getByRole("button", { name: "Desenhar assinatura sintética" }))
  expect(generate).toBeEnabled()
  fireEvent.click(generate)
}

describe("prontuário pronto e arquivamento", () => {
  it("oferece abrir ou baixar enquanto o arquivamento ainda está pendente, acima do perfil", async () => {
    mocks.archive.mockReturnValue(new Promise(() => {}))
    await signAndGenerate()
    const dialog = await screen.findByRole("dialog", { name: "Prontuário NR-06 pronto" })
    expect(within(dialog).getByRole("link", { name: "Visualizar em nova aba" })).toHaveAttribute("href", "blob:synthetic-document")
    expect(within(dialog).getByRole("link", { name: "Baixar PDF" })).toHaveAttribute("download", "Ficha_NR06_COLABORADOR_TESTE.pdf")
    expect(dialog.parentElement?.parentElement).toBe(document.body)
    expect(screen.getByRole("dialog", { name: "Prontuario do colaborador" })).toBeInTheDocument()
    expect(screen.queryByRole("dialog", { name: "Assinar prontuario" })).not.toBeInTheDocument()
    expect(mocks.archive).toHaveBeenCalledTimes(1)
    expect(mocks.getHistory).toHaveBeenLastCalledWith(employee.id, { signAssets: false })
  })

  it("mantém o PDF disponível se o armazenamento recusar o arquivamento", async () => {
    mocks.archive.mockRejectedValue(new Error("Armazenamento temporariamente indisponível"))
    await signAndGenerate()
    expect(await screen.findByRole("dialog", { name: "Prontuário NR-06 pronto" })).toBeInTheDocument()
    expect(mocks.generate).toHaveBeenCalledTimes(1)
  })
})
