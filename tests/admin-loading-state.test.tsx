import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"

const mocks = vi.hoisted(() => ({ getUsers: vi.fn(), getCompanies: vi.fn(), push: vi.fn(), user: { id: "owner", role: "MASTER" } }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }))
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({
  user: mocks.user, loading: false,
}) }))
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock("@/services/api", () => ({ api: {
  getUsers: mocks.getUsers, getCompanies: mocks.getCompanies, getMasterCompanyContext: () => "company-a",
} }))
import UsersPage from "@/app/users/page"
import CompaniesPage from "@/app/companies/page"

beforeEach(() => { vi.clearAllMocks(); mocks.getUsers.mockResolvedValue([]); mocks.getCompanies.mockResolvedValue([]) })

describe("admin screens distinguish failures from empty accounts", () => {
  it("offers retry for a failed user list without claiming no users exist", async () => {
    mocks.getUsers.mockRejectedValueOnce(new Error("network unavailable"))
    render(<UsersPage />)
    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível atualizar os usuários")
    expect(screen.queryByText("Nenhum usuário cadastrado nesta empresa.")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }))
    expect(await screen.findByText("Nenhum usuário cadastrado nesta empresa.")).toBeInTheDocument()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })
  it("does not turn failed company counts into zero or an empty customer list", async () => {
    mocks.getCompanies.mockRejectedValueOnce(new Error("network unavailable"))
    render(<CompaniesPage />)
    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível consultar as empresas")
    expect(screen.queryByText("Nenhuma empresa encontrada")).not.toBeInTheDocument()
    expect(screen.getAllByText("—")).toHaveLength(7)
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }))
    expect(await screen.findByText("Nenhuma empresa encontrada")).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument())
  })
})
