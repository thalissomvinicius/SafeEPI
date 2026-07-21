import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AuthProvider, useAuth } from "@/contexts/AuthContext"

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getCurrentUser: vi.fn(),
  getMasterCompanyContext: vi.fn(),
  getCompanies: vi.fn(),
  setMasterCompanyContext: vi.fn(),
  primeCompanyContext: vi.fn(),
  resetCompanyContext: vi.fn(),
  logout: vi.fn(),
  replace: vi.fn(),
  renderProbe: vi.fn(),
  authCallback: null as null | ((event: string) => void),
  pathname: "/",
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
  usePathname: () => mocks.pathname,
}))

vi.mock("@/services/api", () => ({
  api: {
    getSession: mocks.getSession,
    getCurrentUser: mocks.getCurrentUser,
    getMasterCompanyContext: mocks.getMasterCompanyContext,
    getCompanies: mocks.getCompanies,
    setMasterCompanyContext: mocks.setMasterCompanyContext,
    primeCompanyContext: mocks.primeCompanyContext,
    resetCompanyContext: mocks.resetCompanyContext,
    logout: mocks.logout,
  },
}))

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      onAuthStateChange: vi.fn((callback: (event: string) => void) => {
        mocks.authCallback = callback
        return { data: { subscription: { unsubscribe: vi.fn() } } }
      }),
    },
  },
}))

vi.mock("@/lib/brandTheme", () => ({
  applyCompanyBrand: vi.fn(),
  clearCompanyTheme: vi.fn(),
}))

function AuthProbe() {
  const { user } = useAuth()
  mocks.renderProbe(user?.role || null)
  return <span>{user?.role || "sem-usuario"}</span>
}

describe("AuthProvider company context", () => {
  afterEach(() => cleanup())

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.pathname = "/"
    mocks.authCallback = null
    mocks.getSession.mockResolvedValue({
      user: {
        id: "user-1",
        email: "master@safeepi.test",
        user_metadata: { full_name: "Master" },
      },
    })
    mocks.getMasterCompanyContext.mockReturnValue(null)
    mocks.getCompanies.mockResolvedValue([
      { id: "company-1", name: "Empresa 1", active: true },
    ])
  })

  it("define a empresa MASTER antes de renderizar as telas protegidas", async () => {
    mocks.getCurrentUser.mockResolvedValue({
      id: "user-1",
      email: "master@safeepi.test",
      full_name: "Master",
      role: "MASTER",
      company_id: null,
      company: null,
    })

    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    )

    expect(screen.queryByText("MASTER")).not.toBeInTheDocument()
    expect(await screen.findByText("MASTER")).toBeInTheDocument()
    expect(mocks.setMasterCompanyContext).toHaveBeenCalledWith("company-1")
    expect(mocks.setMasterCompanyContext.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.renderProbe.mock.invocationCallOrder.at(-1) || Number.MAX_SAFE_INTEGER)
  })

  it("prepara diretamente o tenant de usuarios nao-MASTER", async () => {
    const profile = {
      id: "user-2",
      email: "admin@safeepi.test",
      full_name: "Admin",
      role: "ADMIN",
      company_id: "company-2",
      company: null,
    }
    mocks.getCurrentUser.mockResolvedValue(profile)

    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    )

    expect(await screen.findByText("ADMIN")).toBeInTheDocument()
    expect(mocks.primeCompanyContext).toHaveBeenCalledWith(profile)
    expect(mocks.getCompanies).not.toHaveBeenCalled()
  })

  it("mantem o usuario atual quando uma reidratacao de token falha temporariamente", async () => {
    mocks.getCurrentUser.mockResolvedValueOnce({
      id: "user-2",
      email: "admin@safeepi.test",
      full_name: "Admin",
      role: "ADMIN",
      company_id: "company-2",
      company: null,
    })

    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    )

    expect(await screen.findByText("ADMIN")).toBeInTheDocument()
    mocks.getCurrentUser.mockRejectedValueOnce(new Error("falha temporaria"))

    await act(async () => {
      mocks.authCallback?.("TOKEN_REFRESHED")
    })

    await waitFor(() => expect(mocks.getCurrentUser).toHaveBeenCalledTimes(2))
    expect(screen.getByText("ADMIN")).toBeInTheDocument()
    expect(mocks.replace).not.toHaveBeenCalledWith("/login")
  })

  it("renderiza a pagina de login mesmo quando a leitura da sessao fica pendente", () => {
    mocks.pathname = "/login"
    mocks.getSession.mockReturnValue(new Promise(() => {}))

    render(
      <AuthProvider>
        <span>Formulario de login</span>
      </AuthProvider>,
    )

    expect(screen.getByText("Formulario de login")).toBeInTheDocument()
    expect(screen.queryByText("Verificando seguranca")).not.toBeInTheDocument()
    expect(mocks.replace).not.toHaveBeenCalled()
  })
})
