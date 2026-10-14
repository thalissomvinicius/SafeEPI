import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import RemoteCapturePage from "@/app/capture/[id]/page"
import EmployeesPage from "@/app/employees/page"

const navigation = vi.hoisted(() => ({ token: "capture-token", id: "employee-1" }))
const authUser = vi.hoisted(() => ({ id: "operator-1", role: "ADMIN" }))
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: authUser }) }))
vi.mock("@/hooks/usePdfActionDialog", () => ({ usePdfActionDialog: () => ({ openPdfDialog: vi.fn(), pdfActionDialog: null }) }))
vi.mock("@/utils/pdfGenerator", () => ({ generateEmployeesReportPDF: vi.fn(), generateNR06PDF: vi.fn() }))
vi.mock("@/services/api", () => ({ api: {
  getEmployees: async () => [{ id: "employee-1", full_name: "ANA SILVA", cpf: "000.000.000-00", job_title: "OPERADOR", department: "OBRA", active: true, workplace_id: null }],
  getWorkplaces: async () => [], getThirdParties: async () => [],
  getJobTitles: async () => [{ id: "role-1", name: "OPERADOR", active: true }],
  getDepartments: async () => [{ id: "department-1", name: "OBRA", active: true }],
  getMasterCompanyContext: () => null, getAuthHeaders: async () => ({ Authorization: "Bearer test-token" }),
} }))
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: navigation.id }),
  useSearchParams: () => new URLSearchParams(navigation.token ? { t: navigation.token } : {}),
}))
vi.mock("@/components/ui/FaceCamera", () => ({
  FaceCamera: ({ onEnrolled }: { onEnrolled: (result: unknown, image: string) => void }) => (
    <button onClick={() => onEnrolled({ enrollment_id: "enrollment-1", status: "pending", model_id: "sface-v1" }, "data:image/jpeg;base64,AA")}>Simular envio</button>
  ),
}))
vi.mock("@/components/biometrics/FingerprintEnrollmentManager", () => ({
  FingerprintEnrollmentManager: ({ employeeName }: { employeeName: string }) => <p>Cadastro digital: {employeeName}</p>,
}))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe("Cadastro facial remoto supervisionado", () => {
  beforeEach(() => {
    navigation.token = "capture-token"
    navigation.id = "employee-1"
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ link: { employee_id: "employee-1", type: "capture", status: "pending", token: "capture-token", employee: { id: "employee-1", full_name: "ANA SILVA" } } }),
    }))
  })

  it("bloqueia o cadastro sem link autenticado, sem consultar o endpoint legado", async () => {
    navigation.token = ""
    render(<RemoteCapturePage />)
    expect(await screen.findByText(/Solicite um novo link de cadastro/i)).toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
    expect(screen.queryByRole("button", { name: /iniciar câmera/i })).not.toBeInTheDocument()
  })

  it("não aceita link de outra finalidade", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ link: { employee_id: "employee-1", type: "delivery", status: "pending", employee: { id: "employee-1", full_name: "ANA SILVA" } } }) } as Response)
    render(<RemoteCapturePage />)
    expect(await screen.findByText(/não corresponde a este cadastro/i)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /iniciar câmera/i })).not.toBeInTheDocument()
  })

  it("envia para revisão e nunca anuncia cadastro ativo com base apenas na foto", async () => {
    render(<RemoteCapturePage />)
    fireEvent.click(await screen.findByRole("button", { name: /iniciar câmera/i }))
    fireEvent.click(screen.getByRole("button", { name: "Simular envio" }))
    expect(await screen.findByRole("heading", { name: /cadastro enviado para revisão/i })).toBeInTheDocument()
    expect(screen.getByText(/ainda não está liberado/i)).toBeInTheDocument()
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    expect(vi.mocked(fetch).mock.calls[0][0]).toContain("/api/remote-links?")
  })
})

describe("Revisão do cadastro facial na empresa", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_FACIAL_V2_ENABLED", "true")
    window.localStorage.clear()
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: "pending", enrollment_id: "enrollment-1", model_id: "sface-v1", photo_url: "https://example.org/capture.jpg" }) }))
  })

  it("keeps manual editing available without querying an unconfigured facial feature", async () => {
    vi.stubEnv("NEXT_PUBLIC_FACIAL_V2_ENABLED", "false")
    render(<EmployeesPage />)
    fireEvent.click((await screen.findAllByRole("button", { name: "Editar" }))[0])
    expect(screen.getByText("Verificação facial indisponível")).toBeInTheDocument()
    expect(screen.getByText("Cadastro digital: ANA SILVA")).toBeInTheDocument()
    expect(screen.queryByLabelText("Matrícula na empresa (opcional)")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /cadastrar rosto presencialmente/i })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Gerar Link de Captura Remota/i })).not.toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
  })

  it("exige salvar o colaborador antes de permitir a captura facial", async () => {
    render(<EmployeesPage />)
    await screen.findAllByText("ANA SILVA")
    fireEvent.click(screen.getByRole("button", { name: "Novo" }))
    expect(screen.getByText(/Salve primeiro o colaborador/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /cadastrar rosto presencialmente/i })).toBeDisabled()
  })

  it("exige revisão explícita e envia a aprovação do cadastro correto", async () => {
    render(<EmployeesPage />)
    fireEvent.click((await screen.findAllByRole("button", { name: "Editar" }))[0])
    const approve = await screen.findByRole("button", { name: "Aprovar cadastro facial" })
    expect(approve).toBeDisabled()
    const identityCheck = screen.getByRole("checkbox", { name: /Conferi a identidade/i })
    expect(identityCheck).toBeDisabled()
    fireEvent.load(screen.getByRole("img", { name: "Captura pendente de conferência de identidade" }))
    await waitFor(() => expect(identityCheck).toBeEnabled())
    fireEvent.click(identityCheck)
    expect(approve).toBeEnabled()
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ status: "approved", enrollment_id: "enrollment-1", model_id: "sface-v1" }) } as Response)
    fireEvent.click(approve)
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/facial/enroll/approve", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ employee_id: "employee-1", enrollment_id: "enrollment-1", confirm_identity: true }),
    })))
  })
})
