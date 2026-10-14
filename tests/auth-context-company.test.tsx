import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AuthProvider, useAuth } from "@/contexts/AuthContext"
import LoginPage from "@/app/login/page"

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getCurrentUser: vi.fn(),
  getMasterCompanyContext: vi.fn(),
  getCompanies: vi.fn(),
  setMasterCompanyContext: vi.fn(),
  primeCompanyContext: vi.fn(),
  resetCompanyContext: vi.fn(),
  logout: vi.fn(),
  login: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  renderProbe: vi.fn(),
  authCallback: null as null | ((event: string, session?: { user: { id: string } }) => void),
  pathname: "/",
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }),
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
    login: mocks.login,
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
    window.history.replaceState({}, "", "/")
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

  it("nao recarrega o perfil nem bloqueia a navegacao ao renovar o token", async () => {
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
    await act(async () => {
      mocks.authCallback?.("TOKEN_REFRESHED")
    })

    expect(mocks.getCurrentUser).toHaveBeenCalledTimes(1)
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

  it("entra uma vez e redireciona somente depois do perfil e tenant estarem prontos", async () => {
    mocks.pathname = "/login"
    window.history.replaceState({}, "", "/login?redirectTo=%2Fdelivery")
    mocks.getSession.mockResolvedValue(null)
    let resolveProfile!: (profile: unknown) => void
    mocks.getCurrentUser.mockReturnValue(new Promise((resolve) => { resolveProfile = resolve }))
    const session = { user: { id: "user-2", email: "admin@safeepi.test", user_metadata: {} } }
    mocks.login.mockImplementation(async () => {
      window.dispatchEvent(new Event("safeepi:auth-sync"))
      mocks.authCallback?.("SIGNED_IN", session)
      return { session }
    })
    render(<AuthProvider><LoginPage /></AuthProvider>)
    await waitFor(() => expect(mocks.getSession).toHaveBeenCalled())
    fireEvent.change(screen.getByLabelText("E-mail corporativo"), { target: { value: "admin@safeepi.test" } })
    fireEvent.change(screen.getByLabelText("Senha de acesso"), { target: { value: "password-test" } })
    fireEvent.click(screen.getByRole("button", { name: "Entrar no SafeEPI" }))
    await waitFor(() => expect(mocks.getCurrentUser).toHaveBeenCalledTimes(1))
    expect(mocks.login).toHaveBeenCalledTimes(1)
    expect(mocks.replace).not.toHaveBeenCalled()

    await act(async () => { resolveProfile({ id: "user-2", email: "admin@safeepi.test", role: "ADMIN", company_id: "company-2", company: null }) })
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/delivery"))
    expect(mocks.replace).toHaveBeenCalledTimes(1)
    expect(mocks.primeCompanyContext).toHaveBeenCalledWith(expect.objectContaining({ company_id: "company-2" }))
    expect(mocks.primeCompanyContext.mock.invocationCallOrder.at(-1)).toBeLessThan(mocks.replace.mock.invocationCallOrder[0])
    expect(mocks.refresh).toHaveBeenCalledTimes(1)
  })

  it("mantem a sessao em falhas temporarias de perfil e permite tentar novamente", async () => {
    mocks.getCurrentUser.mockRejectedValueOnce(new Error("Servidor temporariamente indisponivel"))
    mocks.getCurrentUser.mockResolvedValueOnce({ id: "user-1", role: "ADMIN", company_id: "company-2", company: null })
    render(<AuthProvider><AuthProbe /></AuthProvider>)
    expect(await screen.findByRole("alert")).toHaveTextContent("Servidor temporariamente indisponivel")
    expect(mocks.replace).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }))
    expect(await screen.findByText("ADMIN")).toBeInTheDocument()
    expect(mocks.logout).not.toHaveBeenCalled()
  })

  it("ignora hidratacao anonima atrasada ao iniciar um login", async () => {
    mocks.pathname = "/login"
    let resolveOldSession!: (session: null) => void
    mocks.getSession.mockReturnValue(new Promise((resolve) => { resolveOldSession = resolve }))
    mocks.login.mockResolvedValue({ session: { user: { id: "user-2", user_metadata: {} } } })
    mocks.getCurrentUser.mockResolvedValue({ id: "user-2", role: "ADMIN", company_id: "company-2", company: null })
    render(<AuthProvider><LoginPage /></AuthProvider>)
    await waitFor(() => expect(mocks.getSession).toHaveBeenCalled())
    fireEvent.change(screen.getByLabelText("E-mail corporativo"), { target: { value: "admin@safeepi.test" } })
    fireEvent.change(screen.getByLabelText("Senha de acesso"), { target: { value: "password-test" } })
    fireEvent.click(screen.getByRole("button", { name: "Entrar no SafeEPI" }))
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/"))
    await act(async () => { resolveOldSession(null) })
    expect(mocks.resetCompanyContext).not.toHaveBeenCalled()
    expect(mocks.replace).toHaveBeenCalledTimes(1)
  })
})
