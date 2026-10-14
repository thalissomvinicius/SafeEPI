import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import RemoteCapturePage from "@/app/capture/[id]/page"
import EmployeesPage from "@/app/employees/page"

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "operator", role: "ADMIN" } }) }))
vi.mock("@/hooks/usePdfActionDialog", () => ({ usePdfActionDialog: () => ({ openPdfDialog: vi.fn(), pdfActionDialog: null }) }))
vi.mock("@/utils/pdfGenerator", () => ({ generateEmployeesReportPDF: vi.fn(), generateNR06PDF: vi.fn() }))
vi.mock("@/services/api", () => ({ api: {
  getEmployees: async () => [{ id: "employee-1", full_name: "ANA SILVA", cpf: "000.000.000-00", job_title: "OPERADOR", department: "OBRA", active: true }],
  getWorkplaces: async () => [], getThirdParties: async () => [],
  getJobTitles: async () => [{ id: "role", name: "OPERADOR", active: true }],
  getDepartments: async () => [{ id: "department", name: "OBRA", active: true }],
  getMasterCompanyContext: () => null,
} }))
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe("biometrias retiradas da interface", () => {
  it("link facial antigo não abre câmera nem consulta dados", () => {
    vi.stubGlobal("fetch", vi.fn())
    render(<RemoteCapturePage />)
    expect(screen.getByRole("heading", { name: "Cadastro facial retirado" })).toBeInTheDocument()
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
  })
  it.each(["false", "true"])("mantém edição manual sem biometrias mesmo com configuração antiga %s", async flag => {
    vi.stubEnv("NEXT_PUBLIC_FACIAL_V2_ENABLED", flag)
    vi.stubGlobal("fetch", vi.fn())
    window.localStorage.clear()
    render(<EmployeesPage />)
    fireEvent.click((await screen.findAllByRole("button", { name: "Editar" }))[0])
    expect(screen.getByText("Foto de apoio")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /cadastrar rosto|cadastrar digital|aprovar cadastro facial|captura remota/i })).not.toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
  })
})
