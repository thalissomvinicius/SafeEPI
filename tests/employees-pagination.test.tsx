import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import EmployeesPage from "@/app/employees/page"

const mocks = vi.hoisted(() => ({ employees: vi.fn(), generate: vi.fn(), openPdf: vi.fn() }))
const employees = Array.from({ length: 600 }, (_, index) => ({ id: `employee-${index}`, full_name: `PESSOA ${String(index).padStart(3, "0")}`, cpf: `00000000${String(index).padStart(3, "0")}`, active: true, job_title: "Operador", department: "Obra", workplace_id: null, photo_url: null }))
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "operator-test", role: "ADMIN" } }) }))
vi.mock("@/services/api", () => ({ api: { getEmployees: mocks.employees, getWorkplaces: async () => [], getThirdParties: async () => [], getJobTitles: async () => [], getDepartments: async () => [], getMasterCompanyContext: () => null } }))
vi.mock("@/utils/pdfGenerator", () => ({ generateEmployeesReportPDF: mocks.generate, generateNR06PDF: vi.fn() }))
vi.mock("@/hooks/usePdfActionDialog", () => ({ usePdfActionDialog: () => ({ openPdfDialog: mocks.openPdf, pdfActionDialog: null }) }))
vi.mock("@/hooks/useDocumentArchive", () => ({ useDocumentArchive: () => ({ archiveDocument: vi.fn(), archiveRecovery: null }) }))
beforeEach(() => { vi.clearAllMocks(); mocks.employees.mockResolvedValue(employees); mocks.generate.mockReturnValue(new Blob(["pdf"])) })
afterEach(cleanup)

it("bounds rendered rows while keeping search and export over all 600 metadata records", async () => {
  render(<EmployeesPage />)
  const nav = await screen.findByRole("navigation", { name: "Páginas de colaboradores" })
  expect(mocks.employees).toHaveBeenCalledWith({ signPhotos: false })
  expect(within(nav).getByText(/1–50 de 600/)).toBeInTheDocument()
  expect(screen.queryByText("PESSOA 599")).not.toBeInTheDocument()
  fireEvent.click(within(nav).getByRole("button", { name: "Próxima" }))
  expect(within(nav).getByText(/51–100 de 600/)).toBeInTheDocument()
  fireEvent.click(screen.getByText("Mais ações"))
  fireEvent.click(screen.getByRole("button", { name: "Exportar PDF" }))
  expect(mocks.generate).toHaveBeenCalledWith(expect.objectContaining({ employees: expect.arrayContaining([employees[0], employees[599]]) }))
  expect(mocks.generate.mock.calls[0][0].employees).toHaveLength(600)
  fireEvent.change(screen.getByPlaceholderText("Buscar nome, CPF ou matrícula..."), { target: { value: "PESSOA 599" } })
  expect(await screen.findAllByText("PESSOA 599")).toHaveLength(2)
  expect(within(nav).getByText(/1–1 de 1/)).toBeInTheDocument()
  expect(within(nav).getByRole("button", { name: "Próxima" })).toBeDisabled()
})
